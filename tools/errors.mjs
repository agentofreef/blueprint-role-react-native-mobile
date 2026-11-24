export class ProjectError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}
