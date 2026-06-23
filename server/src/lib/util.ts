import { randomUUID } from 'node:crypto'
import { sb, must } from '@/db'

export const uid = (prefix = 'id') => `${prefix}_${randomUUID().slice(0, 12)}`
export const now = () => new Date().toISOString()

export async function notify(userId: string, type: string, title: string, body: string, refId?: string) {
  must(await sb.from('notifications').insert({
    id: uid('n'), user_id: userId, type, title, body, read: 0, ref_id: refId ?? null, created_at: now(),
  }))
}

export const dmThreadId = (a: string, b: string) => [a, b].sort().join('__')
