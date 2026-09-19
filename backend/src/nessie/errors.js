export class NessieError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class NessieConfigurationError extends NessieError {}

export class NessieHttpError extends NessieError {
  constructor({ method, path, status, body, requestId }) {
    super(`Nessie returned ${status} for ${method} ${path}.`);
    this.method = method;
    this.path = path;
    this.status = status;
    this.body = body;
    this.requestId = requestId;
  }
}

export class NessieNetworkError extends NessieError {}
export class NessieTimeoutError extends NessieError {}
