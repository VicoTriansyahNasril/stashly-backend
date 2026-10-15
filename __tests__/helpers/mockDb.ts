/**
 * Mock Drizzle sederhana: setiap query (rantai method yang di-await) mengambil hasil
 * berikutnya dari antrean `queueResults`. Semua pemanggilan method dicatat di `dbCalls`.
 */
export const dbQueue: unknown[] = [];
export const dbCalls: { method: string; args: unknown[] }[] = [];

export const queueResults = (...results: unknown[]) => dbQueue.push(...results);
export const dbError = (error: Error) => ({ __error: error });

export const resetDb = () => {
  dbQueue.length = 0;
  dbCalls.length = 0;
};

export const calledWith = (method: string) => dbCalls.filter((call) => call.method === method);

const makeChain = (): any =>
  new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'then') {
        const next = dbQueue.length ? dbQueue.shift() : [];
        const settled =
          next && typeof next === 'object' && '__error' in (next as object)
            ? Promise.reject((next as { __error: Error }).__error)
            : Promise.resolve(next);
        return settled.then.bind(settled);
      }
      if (prop === 'transaction') {
        return async (fn: (tx: unknown) => Promise<unknown>) => {
          dbCalls.push({ method: 'transaction', args: [] });
          return fn(makeChain());
        };
      }
      return (...args: unknown[]) => {
        dbCalls.push({ method: String(prop), args });
        return makeChain();
      };
    },
  });

export const db = makeChain();
