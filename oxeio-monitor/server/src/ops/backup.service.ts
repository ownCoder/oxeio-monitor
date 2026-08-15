import { spawn } from 'node:child_process';
import { createHash, pbkdf2Sync, randomBytes, createCipheriv } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { storageRoot } from '../common/storage.config';
import { RunLock } from '../summary/scheduling';
import { BackupStateStore } from './backup.state';
import {
  BACKUP_KEEP_DAYS,
  BACKUP_PART_EXT,
  BACKUP_SHA_EXT as SHA_EXT,
  BACKUP_TIMEOUT_MS,
  PBKDF2_ITERATIONS,
} from './ops.constants';
import {
  backupFileName,
  backupsToDelete,
  isBackupFile,
  isPartFile,
  orphanSidecars,
  parsePgUrl,
  stalePartFiles,
  type PgConnection,
} from './ops.rules';

/** ⚠️ pg_dump-এর stderr কত বাইট পর্যন্ত ধরে রাখা হবে (মেমরি পাহারা) */
const STDERR_CAP = 4000;

export interface BackupCopyResult {
  /** কনফিগ করা ছিল কি না — না থাকলে কপি "ব্যর্থ" নয়, শুধু বন্ধ */
  configured: boolean;
  ok: boolean;
  error: string | null;
  target: string | null;
}

export interface BackupResult {
  ok: boolean;
  /** কেন চালানো হয়নি — চালানো হলে `null` */
  skipped: 'not_configured' | 'already_running' | null;
  fileName: string | null;
  sizeBytes: number | null;
  durationMs: number;
  error: string | null;
  copy: BackupCopyResult;
  /** কতগুলো পুরোনো ফাইল ঘোরানো হলো (দুই ফোল্ডার মিলিয়ে) */
  rotated: number;
}

/**
 * **K02 + K03** — রাত ২:৩০-এর `pg_dump`, এনক্রিপশন, এক্সটার্নাল ড্রাইভে কপি
 * আর পুরোনো ব্যাকআপ ঘোরানো।
 *
 * ⭐ **এনক্রিপশন ঐচ্ছিক নয় (G39)।** এই ডাম্পে ১৫ জনের মাসের পর মাসের
 * কার্যকলাপ, তাদের বেতনের অঙ্ক আর স্ক্রিনশটের সব মেটাডেটা একসাথে থাকে —
 * অর্থাৎ পুরো ব্যবস্থার সবচেয়ে সংবেদনশীল জিনিসটা একটা ফাইলে, আর সেই
 * ফাইলটাই যায় একটা খোলা এক্সটার্নাল ড্রাইভে। ওই ড্রাইভ হারানো মানে
 * সবকিছু হারানো। তাই `BACKUP_PASSPHRASE` না থাকলে ব্যাকআপ **চলে না** —
 * নীরবে প্লেইনটেক্সট ফেলে রাখার চেয়ে ব্যাকআপ না হওয়াই ভালো, যতক্ষণ
 * সেটা কেউ জানে (G04 রোজ মনে করিয়ে দেবে)।
 *
 * ⭐ **ফরম্যাটটা ইচ্ছাকৃতভাবে `openssl enc`-এর সাথে মেলানো।**
 * নিজস্ব হেডার + AES-GCM ব্যবহার করলে integrity পাওয়া যেত, কিন্তু খোলার
 * জন্য আমাদেরই একটা টুল লাগত — আর দুর্যোগের দিনে (সার্ভার পুড়ে গেছে,
 * রিপো নেই) সেই টুলটাই থাকে না। যে ব্যাকআপ স্ট্যান্ডার্ড টুল দিয়ে খোলা
 * যায় না, সেটা ব্যাকআপ নয়। integrity-র জন্য পাশে একটা `.sha256` সাইডকার
 * রাখা হয় — `openssl enc`-এ কোনো AEAD মোড নেই, তাই এটাই সেরা আপস।
 *
 * খোলার কমান্ড (`README-restore.txt`-এও লেখা থাকে):
 * ```
 * openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
 *   -in oxeio-2026-08-11-0230.dump.enc -out oxeio.dump -pass env:BACKUP_PASSPHRASE
 * pg_restore -d oxeio --clean --if-exists oxeio.dump
 * ```
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly lock = new RunLock();

  private readonly passphrase: string;
  private readonly dir: string;
  private readonly copyTo: string | null;
  private readonly keepDays: number;
  private readonly pgDumpBin: string;
  private readonly dockerContainer: string | null;
  private readonly dockerBin: string;
  private readonly dockerDbHost: string;
  private readonly databaseUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly state: BackupStateStore,
  ) {
    this.passphrase = (config.get<string>('BACKUP_PASSPHRASE') ?? '').trim();
    /**
     * ⚠️⚠️ **`?.trim() ||`, `??` নয় — আর এই এক অক্ষরের তফাতেই ব্যাকআপ
     * কোনোদিন চলেনি।**
     *
     * `.env.example`-এ লাইনটা `BACKUP_DIR=` (ফাঁকা) হিসেবে বসানো, তাই
     * `config.get()` ফেরত দেয় **খালি স্ট্রিং**, `undefined` নয়। `??`
     * কেবল `null`/`undefined` ধরে — খালি স্ট্রিং পেরিয়ে যায়। ফলে
     * ডিফল্টটা কোনোদিন ব্যবহারই হয়নি, আর `resolve('')` দাঁড়াত
     * **প্রসেসের cwd**-তে, অর্থাৎ `/app` — যেখানে লেখার অনুমতি নেই।
     *
     * ⭐ ব্যর্থতাটা তবু **জোরে** হয়েছে (`EACCES`), আর সেটা ভাগ্য: ওই
     * ফোল্ডারে লেখার অনুমতি থাকলে ডাম্প নীরবে কনটেইনারের ভেতরে বসত আর
     * প্রতি ডিপ্লয়ে মুছে যেত — কেউ কিছু টেরই পেত না।
     *
     * ⚠️ পাশের প্রতিটা অপশন (`BACKUP_COPY_TO`, `BACKUP_PG_DUMP`,
     * `BACKUP_DOCKER_*`) `?.trim() ||` ব্যবহার করে; **কেবল এটাই `??`
     * ছিল**। একই ফাইলে দু-রকম নিয়ম — ঠিক যেভাবে এই বাগগুলো জন্মায়।
     */
    this.dir = resolve(
      config.get<string>('BACKUP_DIR')?.trim() ||
        // ডকের লেআউট (07 § ৬.২): `D:\oXeio\storage\` -এর পাশে `D:\oXeio\backups\`
        join(storageRoot(config), '..', 'backups'),
    );
    this.copyTo = config.get<string>('BACKUP_COPY_TO')?.trim() || null;

    const keep = Number(config.get<string>('BACKUP_KEEP_DAYS'));
    this.keepDays = Number.isFinite(keep) && keep > 0 ? keep : BACKUP_KEEP_DAYS;

    this.pgDumpBin = config.get<string>('BACKUP_PG_DUMP')?.trim() || 'pg_dump';
    this.dockerContainer =
      config.get<string>('BACKUP_DOCKER_CONTAINER')?.trim() || null;
    this.dockerBin = config.get<string>('BACKUP_DOCKER_BIN')?.trim() || 'docker';
    this.dockerDbHost =
      config.get<string>('BACKUP_DOCKER_DB_HOST')?.trim() || 'localhost';
    this.databaseUrl = config.get<string>('DATABASE_URL') ?? '';

    if (!this.passphrase) {
      // ⭐ "জোরে বলা" এখান থেকেই শুরু — বুটের সময়েই একবার, তারপর G04 রোজ।
      this.logger.error(
        'No BACKUP_PASSPHRASE — the nightly backup will not run. ' +
          'Leaving backup off is safer than dropping the salary and screenshot ' +
          'database on disk without encryption, but you need to know about it (G39).',
      );
    }
    if (!this.copyTo) {
      this.logger.warn(
        'No BACKUP_COPY_TO — backups will only live on the server\'s own disk (K03 off). ' +
          'If that disk dies, the backups go with it.',
      );
    }
  }

  get configured(): boolean {
    return this.passphrase.length > 0;
  }

  /** K03 চালু আছে কি না — `null` মানে এক্সটার্নাল কপি কনফিগারই করা হয়নি */
  get copyTarget(): string | null {
    return this.copyTo;
  }

  /** হেলথ পাতায় দেখানোর জন্য — ⚠️ পাসফ্রেজ কখনোই বেরোয় না */
  get backupDir(): string {
    return this.dir;
  }

  /**
   * এক দফা ব্যাকআপ। ⚠️ কখনো throw করে না — ব্যর্থতা একটা **মান**।
   * শিডিউলার আর হাতে-চালানো দুটোই এখান দিয়েই যায়।
   */
  async runOnce(now = new Date()): Promise<BackupResult> {
    const result = await this.lock.run(() => this.execute(now));

    if (result === null) {
      this.logger.warn('Previous backup still running — skipping this tick');
      return emptyResult('already_running');
    }
    return result;
  }

  private async execute(now: Date): Promise<BackupResult> {
    const startedAt = Date.now();

    if (!this.passphrase) {
      await this.state.markObserved();
      this.logger.error('No BACKUP_PASSPHRASE — backup was not run');
      return emptyResult('not_configured');
    }

    const conn = this.connection();
    if (!conn) {
      const error = 'Could not read DATABASE_URL — backup cannot run';
      this.logger.error(error);
      await this.state.record({ at: now, ok: false, error });
      return { ...emptyResult(null), error, durationMs: Date.now() - startedAt };
    }

    const fileName = backupFileName(now);
    const finalPath = join(this.dir, fileName);
    const partPath = finalPath + BACKUP_PART_EXT;

    let sizeBytes: number | null = null;
    let error: string | null = null;

    try {
      await mkdir(this.dir, { recursive: true });
      const digest = await this.dumpEncrypted(conn, partPath);

      const info = await stat(partPath);
      sizeBytes = info.size;

      // ⚠️ শূন্য বা হাস্যকর ছোট ফাইল = ব্যর্থতা। pg_dump শূন্য কোডে বেরিয়েও
      //    কিছুই না লিখতে পারে (যেমন খালি স্কিমা বা বন্ধ পাইপ), আর তখন
      //    ডিস্কে একটা "ব্যাকআপ" পড়ে থাকত যেটা আসলে কিছুই নয়।
      if (sizeBytes < 512) {
        throw new Error(`The dump is suspiciously small (${sizeBytes} bytes)`);
      }

      await writeFile(partPath + SHA_EXT, `${digest}  ${fileName}\n`, 'utf8');
      // ⭐ এই rename-টাই "ব্যাকআপ হয়েছে" ঘোষণার একমাত্র মুহূর্ত। এর আগে
      //    ফাইলটার নাম `.part`, তাই ঘোরানোর নিয়ম বা কপি কেউই সেটাকে
      //    ব্যাকআপ বলে চেনে না — অসম্পূর্ণ ডাম্প কোনোদিন ব্যাকআপ হিসেবে
      //    গোনা হবে না, এটাই এখানকার সবচেয়ে জরুরি নিশ্চয়তা।
      await rename(partPath + SHA_EXT, finalPath + SHA_EXT);
      await rename(partPath, finalPath);

      this.logger.log(
        `Backup done: ${fileName} (${sizeBytes} bytes, ${Math.round((Date.now() - startedAt) / 1000)}s)`,
      );
    } catch (err) {
      error = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(`Backup failed: ${error}`);
      // ⚠️ অসম্পূর্ণ ফাইল রেখে যাওয়া চলবে না — পরে কেউ সেটাকেই ব্যাকআপ
      //    ভেবে বসত। নাম `.part` বলে ঘোরানোর নিয়ম চিনত না, ফলে চিরকাল থাকত।
      await quietUnlink(partPath, partPath + SHA_EXT);
    }

    const copy = error
      ? { configured: this.copyTo !== null, ok: false, error: null, target: this.copyTo }
      : await this.copyOut(fileName);

    const rotated = await this.rotate(now);

    await this.state.record({
      at: now,
      ok: error === null,
      error,
      fileName: error === null ? fileName : null,
      sizeBytes,
      copy: copy.configured && error === null ? { ok: copy.ok, error: copy.error } : null,
    });

    await this.writeRestoreNote();

    return {
      ok: error === null,
      skipped: null,
      fileName: error === null ? fileName : null,
      sizeBytes,
      durationMs: Date.now() - startedAt,
      error,
      copy,
      rotated,
    };
  }

  // ── pg_dump → AES → ফাইল ──────────────────────────────────────────────────

  /**
   * ⭐ পুরোটা স্ট্রিমে — ডাম্প কখনো প্লেইনটেক্সটে ডিস্ক স্পর্শ করে না।
   *
   * ⚠️ **এই ফাংশনের সবচেয়ে সহজ ভুলটা হলো exit code না দেখা।** pg_dump
   *    মাঝপথে মরে গেলে তার stdout বন্ধ হয়ে যায়, আর `pipeline()` সেটাকে
   *    "স্ট্রিম শেষ" ধরে **সফলভাবেই** ফেরত আসে। ফলে ডিস্কে একটা দিব্যি
   *    দেখতে ফাইল তৈরি হতো, `.sha256` মিলত, কপিও হতো — আর সেটা যে অর্ধেক
   *    ডাম্প তা জানা যেত পুনরুদ্ধারের দিন। তাই স্ট্রিম শেষ হওয়ার **পর**
   *    আলাদা করে exit code মেলানো হয়।
   */
  private async dumpEncrypted(
    conn: PgConnection,
    partPath: string,
  ): Promise<string> {
    const { command, args, env } = this.dumpCommand(conn);

    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      windowsHide: true,
      // ⚠️ ঝুলে যাওয়া ডাম্প নিজে থেকেই মরবে — নইলে RunLock ধরে বসে থেকে
      //    পরদিনের ব্যাকআপও আটকে দিত।
      timeout: BACKUP_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < STDERR_CAP) stderr += chunk.toString('utf8');
    });

    const exited = new Promise<number>((res, rej) => {
      child.once('error', rej);
      child.once('close', (code) => res(code ?? -1));
    });
    // ⚠️ আগেভাগে একটা হ্যান্ডলার — pipeline আগে throw করলে এই promise-টা
    //    unhandled rejection হয়ে পুরো প্রসেস নামিয়ে দিত।
    void exited.catch(() => undefined);

    const stdout = child.stdout;
    if (!stdout) throw new Error('Could not get stdout from pg_dump');

    const salt = randomBytes(8);
    const keyIv = pbkdf2Sync(this.passphrase, salt, PBKDF2_ITERATIONS, 48, 'sha256');
    const cipher = createCipheriv(
      'aes-256-cbc',
      keyIv.subarray(0, 32),
      keyIv.subarray(32, 48),
    );

    const hash = createHash('sha256');
    const tap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        cb(null, chunk);
      },
    });

    const out = createWriteStream(partPath);
    // `openssl enc`-এর হেডার: ASCII "Salted__" + ৮ বাইট salt
    const header = Buffer.concat([Buffer.from('Salted__', 'ascii'), salt]);
    hash.update(header);
    out.write(header);

    try {
      await pipeline(stdout, cipher, tap, out);
    } catch (err) {
      child.kill();
      throw new Error(
        `Could not write the dump: ${err instanceof Error ? err.message : 'unknown error'}` +
          (stderr ? ` · pg_dump: ${firstLine(stderr)}` : ''),
      );
    }

    let code: number;
    try {
      code = await exited;
    } catch (err) {
      throw new Error(this.spawnHint(command, err));
    }

    if (code !== 0) {
      throw new Error(
        `pg_dump exited with code ${code}${stderr ? ` — ${firstLine(stderr)}` : ''}`,
      );
    }

    return hash.digest('hex');
  }

  /**
   * pg_dump কোথায়। ⚠️ Docker-এ Postgres চললে হোস্টে `pg_dump` **থাকেই না** —
   * তখন `docker exec` দিয়ে কন্টেইনারের ভেতরেরটা চালানো হয়। দুটো পথই
   * কনফিগারেবল, কারণ কোনটা সত্যি সেটা কোড থেকে জানার উপায় নেই।
   */
  private dumpCommand(conn: PgConnection): {
    command: string;
    args: string[];
    env: Record<string, string>;
  } {
    // ⚠️ `--format=custom` (কম্প্রেসড) — এনক্রিপশনের **আগে** কম্প্রেস করতেই
    //    হবে, কারণ এনক্রিপ্ট করা বাইট আর কম্প্রেস হয় না। প্লেইন SQL রাখলে
    //    ফাইলটা কয়েক গুণ বড় হতো, আর এক্সটার্নাল ড্রাইভে কপির সময়ও তত।
    //
    // ⚠️ `host` আলাদা প্যারামিটার, কারণ Docker-এর ভেতর থেকে DB সবসময়
    //    কন্টেইনারের নিজের localhost — বাইরের হোস্টনেম (compose-এর
    //    `postgres`) সেখানে অর্থহীন হতে পারে।
    const dumpArgs = (host: string): string[] => [
      '-h', host,
      '-p', conn.port,
      '-U', conn.user,
      '-d', conn.database,
      '--format=custom',
      '--no-owner',
      '--no-privileges',
    ];

    if (this.dockerContainer) {
      return {
        command: this.dockerBin,
        args: [
          'exec',
          /**
           * ⭐ `-e PGPASSWORD` — **শুধু নামটা, মান নয়।** `docker exec` বাকি
           * অংশটা নিজের প্রসেসের env থেকে তুলে নিয়ে কন্টেইনারে পাঠায় (নিচের
           * `env`-এ সেটাই বসানো), ঠিক `docker run`-এর মতোই।
           *
           * ⚠️ `PGPASSWORD=<মান>` লিখলে ডাটাবেসের পাসওয়ার্ড `docker`
           * প্রসেসের argv-তে বসত, আর হোস্টে `ps aux` করা **যেকোনো**
           * ব্যবহারকারী সেটা পড়তে পারত — রাত ২:৩০-এ, রোজ। argv সবার
           * জন্য পাঠযোগ্য, env নয়; তাই পার্থক্যটা কসমেটিক নয়।
           * (ঝুঁকিটা কল্পিত নয়: docker গ্রুপের সদস্য বা মনিটরিং এজেন্ট
           * প্রসেস-তালিকা তোলে।)
           */
          '-e',
          'PGPASSWORD',
          this.dockerContainer,
          'pg_dump',
          ...dumpArgs(this.dockerDbHost),
        ],
        env: { PGPASSWORD: conn.password },
      };
    }

    return {
      command: this.pgDumpBin,
      args: dumpArgs(conn.host),
      // ⚠️ PGPASSWORD env-এ, কমান্ড লাইনে নয় — `ps` করলে যেন পাসওয়ার্ড না দেখা যায়
      env: { PGPASSWORD: conn.password },
    };
  }

  /** ⚠️ ENOENT-এর ডিফল্ট বার্তাটা ("spawn pg_dump ENOENT") কিছুই বোঝায় না */
  private spawnHint(command: string, err: unknown): string {
    const message = err instanceof Error ? err.message : 'unknown error';
    if (!message.includes('ENOENT')) return message;

    return this.dockerContainer
      ? `Could not run \`${command}\` (${message}) — is BACKUP_DOCKER_BIN correct? ` +
          `Container name: ${this.dockerContainer}`
      : `\`${command}\` was not found on PATH (${message}) — ` +
          'install the PostgreSQL client tools and give the full path in BACKUP_PG_DUMP, ' +
          'or set BACKUP_DOCKER_CONTAINER if Postgres runs in Docker.';
  }

  private connection(): PgConnection | null {
    return parsePgUrl(this.databaseUrl);
  }

  // ── K03 · এক্সটার্নাল ড্রাইভ ───────────────────────────────────────────────

  /**
   * ⭐ কপি হয়ে যাওয়ার পর **আবার হ্যাশ মিলিয়ে দেখা হয়**।
   *
   * USB ড্রাইভে অর্ধেক লেখা ফাইল, ভরে যাওয়া ড্রাইভ বা খুলে ফেলা কেবল —
   * তিনটেই `copyFile()`-কে সফল দেখাতে পারে বা প্রায়-সফল ফাইল রেখে যেতে
   * পারে। যাচাই না করলে "অফসাইট কপি আছে" বিশ্বাসটাই মিথ্যা হয়ে যেত, আর
   * সেই মিথ্যাটা ধরা পড়ত ঠিক পুনরুদ্ধারের দিনে। পড়াটা ধীর, কিন্তু এটা
   * রাত ৩টার কাজ — আর এই যাচাইটুকুই কপিটার একমাত্র মূল্য।
   */
  private async copyOut(fileName: string): Promise<BackupCopyResult> {
    if (!this.copyTo) {
      return { configured: false, ok: false, error: null, target: null };
    }

    const target = resolve(this.copyTo);
    const source = join(this.dir, fileName);

    try {
      // ⚠️ ড্রাইভ **নেই** আর ড্রাইভ **খালি** — দুটো আলাদা। `mkdir` দিয়ে
      //    জোর করে বানালে ড্রাইভ খোলা না থাকলেও উইন্ডোজ মাঝে মাঝে পথটা
      //    তৈরি করে ফেলে (সিস্টেম ডিস্কে!), আর তখন "কপি হয়েছে" দেখাত —
      //    অথচ কপিটা পড়ে থাকত সেই একই ডিস্কে, অর্থাৎ কোনো সুরক্ষাই নেই।
      const dirInfo = await stat(target).catch(() => null);
      if (!dirInfo?.isDirectory()) {
        throw new Error(
          `${target} was not found — is the external drive attached?`,
        );
      }

      await copyFile(source, join(target, fileName));
      await copyFile(source + SHA_EXT, join(target, fileName + SHA_EXT));

      const expected = await readDigest(source + SHA_EXT);
      const actual = await sha256File(join(target, fileName));
      if (expected !== actual) {
        throw new Error('sha256 of the copied file does not match — the copy is corrupt');
      }

      this.logger.log(`Backup copied: ${join(target, fileName)}`);
      return { configured: true, ok: true, error: null, target };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(`Backup copy failed (${target}): ${error}`);
      return { configured: true, ok: false, error, target };
    }
  }

  // ── ঘোরানো ────────────────────────────────────────────────────────────────

  /** দুটো ফোল্ডারেই — নইলে এক্সটার্নাল ড্রাইভটা নীরবে ভরে যেত */
  private async rotate(now: Date): Promise<number> {
    const dirs = [this.dir, ...(this.copyTo ? [resolve(this.copyTo)] : [])];
    let removed = 0;

    for (const dir of dirs) {
      try {
        removed += await this.rotateOne(dir, now);
      } catch (err) {
        // ⚠️ ঘোরাতে না পারা ব্যাকআপকে ব্যর্থ করে না — ব্যাকআপটা তো হয়ে গেছে
        this.logger.warn(
          `Could not rotate ${dir}: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
      }
    }
    return removed;
  }

  private async rotateOne(dir: string, now: Date): Promise<number> {
    const names = await readdir(dir);

    const parts: { name: string; mtime: Date }[] = [];
    for (const name of names) {
      if (!isPartFile(name)) continue;
      const info = await stat(join(dir, name)).catch(() => null);
      if (info) parts.push({ name, mtime: info.mtime });
    }

    const doomed = [
      ...backupsToDelete(names, now, this.keepDays),
      ...stalePartFiles(parts, now),
    ];

    for (const name of doomed) {
      // ⚠️ শেষ পাহারা: নামটা সত্যিই আমাদের প্যাটার্নের কি না আরেকবার দেখা।
      //    এই লুপটাই একমাত্র জায়গা যেখানে কোড নিজে থেকে ফাইল **মোছে**।
      if (!isBackupFile(name) && !isPartFile(name)) continue;
      await quietUnlink(join(dir, name), join(dir, name + SHA_EXT));
    }

    // যাদের ব্যাকআপটাই আর নেই, সেই সাইডকারগুলো — উপরের লুপের পরে দেখা হয়
    // যাতে এইমাত্র মোছা ফাইলগুলোর সাইডকারও (যদি বেঁচে থাকে) ধরা পড়ে
    const orphans = orphanSidecars(await readdir(dir));
    for (const name of orphans) await quietUnlink(join(dir, name));

    if (doomed.length > 0) {
      this.logger.log(`${dir}: removed ${doomed.length} old backups`);
    }
    return doomed.length;
  }

  /**
   * ⭐ পুনরুদ্ধারের নির্দেশনা ব্যাকআপের **পাশেই** রাখা হয়।
   *
   * দুর্যোগের দিনে যা থাকে সেটা হলো একটা এক্সটার্নাল ড্রাইভ — সার্ভার নেই,
   * রিপো নেই, ডকুমেন্টেশন নেই। ওই ড্রাইভে যদি শুধু একগাদা `.enc` ফাইল
   * থাকে আর কেউ না জানে ওগুলো কীভাবে খোলে, তাহলে এনক্রিপশনটা ব্যাকআপকে
   * বাঁচায়নি, মেরে ফেলেছে।
   */
  private async writeRestoreNote(): Promise<void> {
    const note = [
      'oXeio — restoring a backup',
      '='.repeat(48),
      '',
      'These files are encrypted with AES-256-CBC, in the `openssl enc` format.',
      "Passphrase = BACKUP_PASSPHRASE from the server's .env (deliberately not written here).",
      '',
      '1. Verify the hash (is the file intact?):',
      '   sha256sum -c oxeio-YYYY-MM-DD-HHMM.dump.enc.sha256',
      '',
      '2. Decrypt:',
      '   export BACKUP_PASSPHRASE=...',
      `   openssl enc -d -aes-256-cbc -pbkdf2 -iter ${PBKDF2_ITERATIONS} -md sha256 \\`,
      '     -in oxeio-YYYY-MM-DD-HHMM.dump.enc -out oxeio.dump \\',
      '     -pass env:BACKUP_PASSPHRASE',
      '',
      '3. Restore (pg_dump --format=custom, so use pg_restore):',
      '   pg_restore -h localhost -U oxeio -d oxeio --clean --if-exists oxeio.dump',
      '',
      'The screenshot files are not in this dump — they live in the storage/ folder',
      'and are copied separately (07 § 6.4, the 3 AM robocopy).',
      '',
    ].join('\n');

    for (const dir of [this.dir, ...(this.copyTo ? [resolve(this.copyTo)] : [])]) {
      try {
        await writeFile(join(dir, 'README-restore.txt'), note, 'utf8');
      } catch {
        // নির্দেশনা লিখতে না পারা ব্যাকআপকে ব্যর্থ করে না
      }
    }
  }
}

function emptyResult(skipped: BackupResult['skipped']): BackupResult {
  return {
    ok: false,
    skipped,
    fileName: null,
    sizeBytes: null,
    durationMs: 0,
    error: null,
    copy: { configured: false, ok: false, error: null, target: null },
    rotated: 0,
  };
}

async function quietUnlink(...paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await unlink(path);
    } catch {
      // ছিল না, বা লক করা — দুটোতেই করার কিছু নেই
    }
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/** সাইডকারের প্রথম শব্দটাই হেক্স ডাইজেস্ট (`sha256sum` ফরম্যাট) */
async function readDigest(shaPath: string): Promise<string> {
  const text = await readFile(shaPath, 'utf8');
  return text.trim().split(/\s+/)[0] ?? '';
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
}
