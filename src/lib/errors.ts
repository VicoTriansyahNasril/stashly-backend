/**
 * Error yang pesannya aman ditampilkan ke client.
 * Error lain (bukan AppError) selalu dibalas dengan pesan generik oleh global error handler,
 * sehingga detail internal (pesan DB, Google API, stack) tidak pernah bocor ke client.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string) => new AppError(400, message);
export const unauthorized = (message = 'Unauthorized') => new AppError(401, message);
export const forbidden = (message = 'Forbidden') => new AppError(403, message);
export const notFound = (message = 'Not found') => new AppError(404, message);
