import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { encrypt, decrypt } from '../common/encryption.util';

interface PendingLogin {
  client: TelegramClient;
  phone: string;
  phoneCodeHash: string;
  resolve: (code: string) => void;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private activeClients = new Map<string, TelegramClient>();
  private pendingLogins = new Map<string, PendingLogin>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private getApiId(): number {
    return parseInt(this.config.get<string>('TELEGRAM_API_ID') ?? '0', 10);
  }

  private getApiHash(): string {
    return this.config.get<string>('TELEGRAM_API_HASH') ?? '';
  }

  async connectWithPhone(
    telegramId: string,
    phone: string,
  ): Promise<{ phoneCodeHash: string; message: string }> {
    const apiId = this.getApiId();
    const apiHash = this.getApiHash();

    const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
      connectionRetries: 3,
    });

    await client.connect();
    const result = await client.sendCode({ apiId, apiHash }, phone);

    // Store client waiting for OTP resolution
    this.pendingLogins.set(telegramId, {
      client,
      phone,
      phoneCodeHash: result.phoneCodeHash,
      resolve: () => {},
    });

    return {
      phoneCodeHash: result.phoneCodeHash,
      message: '✅ OTP sent to your phone! Use /verify_code <OTP> to complete login.',
    };
  }

  async verifyCode(
    telegramId: string,
    code: string,
  ): Promise<{ message: string }> {
    const pending = this.pendingLogins.get(telegramId);
    if (!pending) {
      throw new BadRequestException('No pending login session. Start with /connect first.');
    }

    const { client, phone, phoneCodeHash } = pending;

    try {
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phone,
          phoneCodeHash,
          phoneCode: code,
        }),
      );

      const sessionString = (client.session as StringSession).save();
      const encryptedSession = encrypt(sessionString);

      const user = await this.prisma.user.findUnique({
        where: { telegram_id: telegramId },
      });
      if (!user) throw new BadRequestException('User not found');

      await this.prisma.session.upsert({
        where: { user_id: user.id },
        create: { user_id: user.id, session_string: encryptedSession, phone, status: 'connected' },
        update: { session_string: encryptedSession, phone, status: 'connected' },
      });

      this.activeClients.set(telegramId, client);
      this.pendingLogins.delete(telegramId);

      this.logger.log(`Session saved for user ${telegramId}`);
      return { message: '✅ Account connected successfully!' };
    } catch (error) {
      this.pendingLogins.delete(telegramId);
      throw new BadRequestException(`Login failed: ${(error as Error).message}`);
    }
  }

  async getClient(telegramId: string): Promise<TelegramClient | null> {
    const cached = this.activeClients.get(telegramId);
    if (cached?.connected) return cached;

    const user = await this.prisma.user.findUnique({
      where: { telegram_id: telegramId },
      include: { sessions: true },
    });

    if (!user || !user.sessions[0]) return null;

    const decrypted = decrypt(user.sessions[0].session_string);

    const client = new TelegramClient(
      new StringSession(decrypted),
      this.getApiId(),
      this.getApiHash(),
      { connectionRetries: 3 },
    );

    await client.connect();
    this.activeClients.set(telegramId, client);
    return client;
  }

  async disconnectSession(telegramId: string): Promise<{ message: string }> {
    const client = this.activeClients.get(telegramId);
    if (client) {
      await client.disconnect();
      this.activeClients.delete(telegramId);
    }

    const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
    if (user) {
      await this.prisma.session.updateMany({
        where: { user_id: user.id },
        data: { status: 'disconnected' },
      });
    }

    return { message: '🔌 Session disconnected.' };
  }

  async getSessionStatus(telegramId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { telegram_id: telegramId },
      include: { sessions: { select: { status: true, phone: true } } },
    });

    if (!user || !user.sessions[0]) return 'No session found';
    const s = user.sessions[0];
    return `Status: ${s.status} | Phone: ${s.phone ?? 'N/A'}`;
  }
}
