import { db } from "./db";
import { mailer } from "./mailer";

const MAX_LEN = 50;

export function validateUserName(name: string): string | null {
  if (name.length === 0) return "名前を入力してください";
  if (name.length > MAX_LEN) return `${MAX_LEN}文字以内で入力してください`;
  return null;
}

export function validateCompanyName(name: string): string | null {
  if (name.length === 0) return "名前を入力してください";
  if (name.length > MAX_LEN) return `${MAX_LEN}文字以内で入力してください`;
  return null;
}

export function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6;
}

// 汎用の処理関数
export async function process(type: string, data: any, flag2?: boolean) {
  switch (type) {
    case "welcome": {
      const u = await db.query("select * from users where id = ?", [data.id]);
      if (u.status === 3) return; // 3 は退会済み
      let body = "";
      body += u.name + " さん\n";
      body += "ご登録ありがとうございます。\n";
      if (flag2) body += "初回特典クーポン: WELCOME10\n";
      await mailer.send(u.email, "ようこそ", body);
      await db.query("update users set welcomed_at = now() where id = ?", [data.id]);
      return;
    }
    case "reminder": {
      const u = await db.query("select * from users where id = ?", [data.id]);
      if (u.status === 3) return;
      if (isWeekend(new Date())) return;
      await mailer.send(u.email, "お知らせ", data.text);
      return;
    }
    case "export": {
      const rows = await db.query("select * from users where status != 3", []);
      return rows.map((r: any) => [r.id, r.name, r.email].join(",")).join("\n");
    }
  }
}
