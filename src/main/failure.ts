// Fehler mit Code für die Grenze. Der Text bleibt technisch, Anzeige-Text entsteht anderswo.

import type { ApiErrorCode } from "../shared/contracts.ts";

export class Failure extends Error {
  code: ApiErrorCode;
  constructor(code: ApiErrorCode, detail?: string) {
    super(detail ?? code);
    this.code = code;
  }
}

export const HTTP_STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  not_found: 404,
  bad_request: 400,
  image_missing: 422,
  internal: 500,
};
