import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { encrypt, decrypt } from '../common/encryption.util';

interface PendingLogin {
  client: TelegramClient;
  phone: string;
  phoneCodeHash: string;
}

interface RateEntry {
  count: number;
  windowStart: number;
}

// Max 3 session-string attempts per 10 minutes per user
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  /** Live gramJS clients keyed by  "<telegramId>_<sessionDbId>"  */
  private activeClients = new Map<string, TelegramClient>();

  /** Pending OTP logins keyed by telegramId */
  private pendingLogins = new Map<string, PendingLogin>();

  /** Rate-limit counters keyed by telegramId */
  private rateLimits = new Map<string, RateEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private getApiId(): number {
    return parseInt(this.config.get<string>('TELEGRAM_API_ID') ?? '0', 10);
  }

  private getApiHash(): string {
    return this.config.get<string>('TELEGRAM_API_HASH') ?? '';
  }

  private makeClientKey(telegramId: string, sessionId: number) {
    return `${telegramId}_${sessionId}`;
  }

  private buildClient(sessionStr: string): TelegramClient {
    return new TelegramClient(
      new StringSession(sessionStr),
      this.getApiId(),
      this.getApiHash(),
      { connectionRetries: 3, baseLogger: { levels: [], log: () => {} } as any },
    );
  }

  /** Simple in-memory rate limiter */
  private checkRateLimit(telegramId: string): void {
    const now = Date.now();
    const entry = this.rateLimits.get(telegramId);

    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      this.rateLimits.set(telegramId, { count: 1, windowStart: now });
      return;
    }

    if (entry.count >= RATE_LIMIT_MAX) {
      const remaining = Math.ceil(
        (RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)) / 60000,
      );
      throw new HttpException(
        `تجاوزت الحد المسموح به. انتظر ${remaining} دقيقة وأعد المحاولة.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    entry.count++;
  }

  private async getUserOrThrow(telegramId: string) {
    const user = await this.prisma.user.findUnique({
      where: { telegram_id: telegramId },
    });
    if (!user) throw new NotFoundException('المستخدم غير موجود.');
    return user;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION STRING (direct paste — Telethon / GramJS)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validate and store a pasted Session String.
   * Tries to connect and call GetMe to confirm the session is alive.
   */
  async addSessionString(
    telegramId: string,
    rawSessionString: string,
    label = 'جلسة جديدة',
  ): Promise<{ message: string; accountName: string; accountId: string }> {
    this.checkRateLimit(telegramId);

    const sessionStr = rawSessionString.trim();
    if (!sessionStr || sessionStr.length < 20) {
      throw new BadRequestException('الجلسة المُرسلة قصيرة جداً أو غير صالحة.');
    }

    const client = this.buildClient(sessionStr);

    let me: Api.User;
    try {
      await client.connect();
      const result = await client.invoke(new Api.users.GetFullUser({
        id: new Api.InputUserSelf(),
      }));
      me = result.users[0] as Api.User;
    } catch (err) {
      try { await client.disconnect(); } catch { /* */ }
      this.logger.warn(
        `[addSessionString] invalid session for user ${telegramId}: ${(err as Error).message.substring(0, 60)}`,
      );
      throw new BadRequestException('❌ الجلسة غير صالحة أو منتهية. تأكد من صحة Session String.');
    }

    const accountName = me.username ? `@${me.username}` : (me.firstName ?? 'غير معروف');
    const accountId = me.id?.toString() ?? '';

    const user = await this.getUserOrThrow(telegramId);
    const encryptedSession = encrypt(sessionStr);

    const saved = await this.prisma.session.create({
      data: {
        user_id: user.id,
        label,
        session_string: encryptedSession,
        account_name: accountName,
        account_id: accountId,
        source: 'string',
        status: 'connected',
      },
    });

    // keep client alive in memory
    const key = this.makeClientKey(telegramId, saved.id);
    this.activeClients.set(key, client);

    this.logger.log(
      `[addSessionString] session #${saved.id} added for user ${telegramId} → ${accountName}`,
    );

    return {
      message: `✅ تم ربط الحساب *${accountName}* بنجاح!`,
      accountName,
      accountId,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OTP LOGIN (phone number flow)
  // ═══════════════════════════════════════════════════════════════════════════

  async connectWithPhone(
    telegramId: string,
    phone: string,
  ): Promise<{ phoneCodeHash: string; message: string }> {
    const apiId = this.getApiId();
    const apiHash = this.getApiHash();

    const client = this.buildClient('');
    await client.connect();
    const result = await client.sendCode({ apiId, apiHash }, phone);

    this.pendingLogins.set(telegramId, {
      client,
      phone,
      phoneCodeHash: result.phoneCodeHash,
    });

    return {
      phoneCodeHash: result.phoneCodeHash,
      message: '✅ تم إرسال رمز التحقق إلى هاتفك!',
    };
  }

  async verifyCode(
    telegramId: string,
    code: string,
  ): Promise<{ message: string }> {
    const pending = this.pendingLogins.get(telegramId);
    if (!pending) {
      throw new BadRequestException('لا توجد جلسة معلقة. ابدأ بـ /connect أولاً.');
    }

    const { client, phone, phoneCodeHash } = pending;

    try {
      await client.invoke(
        new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }),
      );

      const sessionStr = (client.session as StringSession).save();
      const encryptedSession = encrypt(sessionStr);

      const user = await this.getUserOrThrow(telegramId);

      const saved = await this.prisma.session.create({
        data: {
          user_id: user.id,
          label: `هاتف ${phone}`,
          session_string: encryptedSession,
          phone,
          source: 'phone',
          status: 'connected',
        },
      });

      const key = this.makeClientKey(telegramId, saved.id);
      this.activeClients.set(key, client);
      this.pendingLogins.delete(telegramId);

      this.logger.log(`[verifyCode] phone session #${saved.id} for user ${telegramId}`);
      return { message: '✅ تم تسجيل الدخول بنجاح!' };
    } catch (error) {
      this.pendingLogins.delete(telegramId);
      throw new BadRequestException(`فشل تسجيل الدخول: ${(error as Error).message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLIENT RETRIEVAL  (used by groups/schedule services)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Returns the first connected/connectable client for this user */
  async getClient(telegramId: string): Promise<TelegramClient | null> {
    const user = await this.prisma.user.findUnique({
      where: { telegram_id: telegramId },
      include: { sessions: { where: { status: 'connected' }, orderBy: { created_at: 'asc' } } },
    });

    if (!user || !user.sessions.length) return null;

    for (const session of user.sessions) {
      const key = this.makeClientKey(telegramId, session.id);
      const cached = this.activeClients.get(key);
      if (cached?.connected) return cached;

      try {
        const decrypted = decrypt(session.session_string);
        const client = this.buildClient(decrypted);
        await client.connect();
        this.activeClients.set(key, client);
        return client;
      } catch {
        // mark this session as disconnected and try next
        await this.prisma.session.update({
          where: { id: session.id },
          data: { status: 'disconnected' },
        });
      }
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  async listSessions(telegramId: string) {
    const user = await this.getUserOrThrow(telegramId);
    return this.prisma.session.findMany({
      where: { user_id: user.id },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        label: true,
        account_name: true,
        account_id: true,
        phone: true,
        source: true,
        status: true,
        created_at: true,
      },
    });
  }

  async deleteSession(telegramId: string, sessionId: number): Promise<{ message: string }> {
    const user = await this.getUserOrThrow(telegramId);

    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, user_id: user.id },
    });

    if (!session) throw new NotFoundException('الجلسة غير موجودة.');

    // Disconnect live client if present
    const key = this.makeClientKey(telegramId, sessionId);
    const client = this.activeClients.get(key);
    if (client) {
      try { await client.disconnect(); } catch { /* */ }
      this.activeClients.delete(key);
    }

    await this.prisma.session.delete({ where: { id: sessionId } });

    this.logger.log(`[deleteSession] session #${sessionId} deleted for user ${telegramId}`);
    return { message: `🗑️ تم حذف الجلسة "${session.label}" بنجاح.` };
  }

  async disconnectSession(telegramId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
    if (!user) return { message: '🔌 لا توجد جلسات.' };

    const sessions = await this.prisma.session.findMany({ where: { user_id: user.id } });

    for (const s of sessions) {
      const key = this.makeClientKey(telegramId, s.id);
      const client = this.activeClients.get(key);
      if (client) {
        try { await client.disconnect(); } catch { /* */ }
        this.activeClients.delete(key);
      }
    }

    await this.prisma.session.updateMany({
      where: { user_id: user.id },
      data: { status: 'disconnected' },
    });

    return { message: '🔌 تم قطع جميع الجلسات.' };
  }

  async getSessionStatus(telegramId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { telegram_id: telegramId },
      include: {
        sessions: {
          select: { id: true, label: true, status: true, account_name: true, phone: true },
        },
      },
    });

    if (!user || !user.sessions.length) return 'لا توجد جلسات مسجلة.';

    return user.sessions
      .map(
        (s) =>
          `#${s.id} | ${s.label} | ${s.status === 'connected' ? '🟢 متصل' : '🔴 غير متصل'}` +
          (s.account_name ? ` | ${s.account_name}` : '') +
          (s.phone ? ` | ${s.phone}` : ''),
      )
      .join('\n');
  }
}
