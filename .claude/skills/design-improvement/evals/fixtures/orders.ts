// orders.ts — 注文まわりの処理

import { db } from "./db";
import { mailer } from "./mailer";

export interface Order {
  id: string;
  items: { price: number; qty: number }[];
  isPaid: boolean;
  isShipped: boolean;
  isCancelled: boolean;
  memberRank: "normal" | "gold";
  email: string;
}

// 価格計算の戦略。将来いろいろな計算方法を差し替えられるように
interface PricingStrategy {
  calc(order: Order): number;
}
class DefaultPricingStrategy implements PricingStrategy {
  calc(order: Order): number {
    const subtotal = order.items.reduce((s, i) => s + i.price * i.qty, 0);
    const discounted = order.memberRank === "gold" ? subtotal * 0.9 : subtotal;
    return Math.floor(discounted * 1.1); // 税込
  }
}
class PricingStrategyFactory {
  static create(): PricingStrategy {
    return new DefaultPricingStrategy();
  }
}

export async function checkout(orderId: string, sendMail: boolean) {
  const row = await db.query("select * from orders where id = ?", [orderId]);
  if (!row) throw new Error("not found");
  const order: Order = JSON.parse(row.payload);
  // 支払い済みで未発送かつキャンセルされていない注文だけ処理する
  if (!(order.isPaid && !order.isShipped && !order.isCancelled)) {
    return { ok: false };
  }
  const total = PricingStrategyFactory.create().calc(order);
  await db.query("update orders set total = ? where id = ?", [total, orderId]);
  if (sendMail) {
    const body =
      "ご注文ありがとうございます。\n" +
      "合計: " + total.toLocaleString() + "円（税込）\n";
    await mailer.send(order.email, "注文確定", body);
  }
  return { ok: true, total };
}

export function canShip(order: Order): boolean {
  return order.isPaid && !order.isShipped && !order.isCancelled;
}

export function estimateTotal(order: Order): number {
  const subtotal = order.items.reduce((s, i) => s + i.price * i.qty, 0);
  const discounted = order.memberRank === "gold" ? subtotal * 0.9 : subtotal;
  return Math.floor(discounted * 1.1);
}

// 管理画面の一覧表示用。ステータス文字列を作る
export function statusLabel(order: Order): string {
  if (order.isCancelled) return "キャンセル";
  if (order.isShipped) return "発送済み";
  if (order.isPaid) return "発送待ち";
  return "未払い";
}

// 返品の受付期限（日数）。会員ランクで変わる
export function returnWindowDays(order: Order): number {
  return order.memberRank === "gold" ? 30 : 14;
}

// 配送料の無料閾値（円）。会員ランクで変わる
export function freeShippingThreshold(order: Order): number {
  return order.memberRank === "gold" ? 3000 : 5000;
}
