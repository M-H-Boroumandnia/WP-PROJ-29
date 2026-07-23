export class RepositoryError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: unknown = null,
  ) {
    super(message);
  }
}
