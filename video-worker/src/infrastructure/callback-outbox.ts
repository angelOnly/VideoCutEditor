import { randomUUID, createHmac } from 'node:crypto';
import type { Database } from './postgres.js';
import type { Tenant } from '../config.js';
import { callbackPath } from '../integrations/ifeng/mapper.js';
export class CallbackOutbox {
  constructor(
    private db: Database,
    private tenants: Tenant[],
    private transport: typeof fetch = fetch,
    private maxAttempts = 10,
  ) {}
  async sendOne() {
    const owner = randomUUID();
    const event = await this.db.tx(async (q) => {
      const row = (
        await q.query(
          "SELECT * FROM callback_events WHERE state IN ('pending','retrying') AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<=now()) ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
        )
      ).rows[0];
      if (!row) return null;
      if (row.attempts >= this.maxAttempts) {
        await q.query(
          "UPDATE callback_events SET state='dead_letter',lease_owner=NULL,lease_until=NULL,last_error='回调尝试次数已用尽' WHERE id=$1",
          [row.id],
        );
        return null;
      }
      return (
        await q.query(
          "UPDATE callback_events SET lease_owner=$2,lease_until=now()+interval '30 seconds',attempts=attempts+1 WHERE id=$1 RETURNING *",
          [row.id, owner],
        )
      ).rows[0];
    });
    if (!event) return false;
    let state = 'retrying',
      error = '',
      delay = Math.min(3600, 2 ** event.attempts) + Math.floor(Math.random() * 3);
    const tenant = this.tenants.find((t) => t.id === event.tenant);
    if (!tenant) {
      state = 'dead_letter';
      error = '调用方配置不存在';
    } else
      try {
        const body = JSON.stringify(event.payload),
          timestamp = String(Math.floor(Date.now() / 1000));
        const signature = createHmac('sha256', tenant.callbackSecret)
          .update(timestamp + '.' + body)
          .digest('hex');
        const response = await this.transport(
          new URL(callbackPath(event.stage), tenant.callbackBaseUrl),
          {
            method: 'POST',
            redirect: 'error',
            headers: {
              'content-type': 'application/json',
              'x-event-id': event.id,
              'x-callback-timestamp': timestamp,
              'x-callback-signature': signature,
            },
            body,
            signal: AbortSignal.timeout(15000),
          },
        );
        const reader = response.body?.getReader();
        let text = '',
          bytes = 0;
        if (reader) {
          for (;;) {
            const r = await reader.read();
            if (r.done) break;
            bytes += r.value.byteLength;
            if (bytes > 65536) {
              await reader.cancel();
              throw Error('回调响应过大');
            }
            text += new TextDecoder().decode(r.value);
          }
        }
        if (response.ok) {
          let payload: any;
          try {
            payload = JSON.parse(text);
          } catch {
            /* Invalid response remains retryable. */
          }
          if (payload?.status === 0) state = 'delivered';
          else {
            error = '回调未返回业务成功';
            if (payload?.status !== undefined) state = 'dead_letter';
          }
        } else {
          error = `HTTP ${response.status}`;
          if (response.status !== 429 && response.status < 500) state = 'dead_letter';
        }
        const retry = response.headers.get('retry-after');
        if (retry) {
          const seconds = Number(retry);
          const n = Number.isFinite(seconds) ? seconds : (Date.parse(retry) - Date.now()) / 1000;
          if (Number.isFinite(n)) delay = Math.max(delay, Math.min(86400, Math.max(0, n)));
        }
      } catch {
        error = '回调连接失败或响应无效';
      }
    if (state === 'retrying' && event.attempts >= this.maxAttempts) state = 'dead_letter';
    await this.db.query(
      "UPDATE callback_events SET state=$3,last_error=$4,next_attempt_at=now()+($5 * interval '1 second'),lease_owner=NULL,lease_until=NULL,delivered_at=CASE WHEN $3='delivered' THEN now() ELSE NULL END WHERE id=$1 AND lease_owner=$2",
      [event.id, owner, state, error || null, delay],
    );
    return true;
  }
  async retry(tenant: string, eventId: string) {
    return (
      (
        await this.db.query(
          "UPDATE callback_events SET state='pending',attempts=0,next_attempt_at=now(),last_error=NULL WHERE id=$1 AND tenant=$2 AND state='dead_letter' RETURNING id",
          [eventId, tenant],
        )
      ).rows[0] ?? null
    );
  }
}
