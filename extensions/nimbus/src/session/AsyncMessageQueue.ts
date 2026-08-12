/**
 * ストリーミング入力モード（query({ prompt: AsyncIterable })）へ
 * 追加のユーザーメッセージを push するための非同期キュー。
 */
export class AsyncMessageQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = []
  private resolvers: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  push(item: T): void {
    if (this.closed) {
      throw new Error('AsyncMessageQueue is closed')
    }
    const resolve = this.resolvers.shift()
    if (resolve) {
      resolve({ value: item, done: false })
    } else {
      this.buffer.push(item)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const resolve of this.resolvers.splice(0)) {
      resolve({ value: undefined, done: true })
    }
  }

  get isClosed(): boolean {
    return this.closed
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift() as T, done: false })
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true })
        }
        return new Promise((resolve) => this.resolvers.push(resolve))
      }
    }
  }
}
