-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Session" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'الحساب الافتراضي',
    "session_string" TEXT NOT NULL,
    "phone" TEXT,
    "account_name" TEXT,
    "account_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'phone',
    "status" TEXT NOT NULL DEFAULT 'connected',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "Session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Session" ("created_at", "id", "phone", "session_string", "status", "updated_at", "user_id") SELECT "created_at", "id", "phone", "session_string", "status", "updated_at", "user_id" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
