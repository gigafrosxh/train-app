import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
export function fail(
  status: number,
  code: string,
  message: string,
  extra: any = {},
): never {
  throw new HttpException({ code, message, ...extra }, status);
}
@Catch()
export class Errors implements ExceptionFilter {
  catch(e: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let status = 500,
      body: any = {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      };
    if (e instanceof HttpException) {
      status = e.getStatus();
      const r = e.getResponse();
      body = typeof r === "object" ? r : { message: r, code: "REQUEST_FAILED" };
    } else if (e.code === "23505") {
      status = 409;
      body = {
        code: "RESOURCE_EXISTS",
        message: "This record already exists.",
      };
    } else if (e.code === "23503") {
      status = 409;
      body = {
        code: "RESOURCE_IN_USE",
        message: "Referenced record is missing or still in use.",
      };
    } else if (["23514", "22007", "22008", "22P02"].includes(e.code)) {
      status = 400;
      body = { code: "VALIDATION_FAILED", message: "Invalid data." };
    }
    if (status === 500) console.error(e);
    res
      .status(status)
      .json({
        statusCode: status,
        code: body.code ?? "REQUEST_FAILED",
        ...body,
        requestId: res.getHeader("X-Request-Id") ?? randomUUID(),
      });
  }
}
