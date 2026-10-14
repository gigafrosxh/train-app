import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { json } from "express";
import { randomUUID } from "node:crypto";
import { AppModule } from "./app.module";
import { Errors } from "./common/errors";
import { security } from "./auth/security";
import { connect } from "./database/database";
export async function createApp(
  options: { database?: boolean; logger?: boolean } = {},
) {
  for (const k of ["JWT_SECRET", "CSRF_SECRET"])
    if ((process.env[k]?.length ?? 0) < 32)
      throw new Error(k + " must contain at least 32 characters");
  if (options.database !== false) await connect();
  const app = await NestFactory.create(AppModule, {
    logger: options.logger === false ? false : ["error", "warn", "log"],
    bodyParser: false,
  });
  app.use(helmet());
  app.use(json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use((req: any, res: any, next: any) => {
    res.setHeader("X-Request-Id", randomUUID());
    next();
  });
  app.use(security);
  app.enableCors({
    origin: (
      process.env.ALLOWED_ORIGINS ??
      "http://localhost:4200,http://localhost:3000"
    ).split(","),
    credentials: true,
  });
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new Errors());
  app.enableShutdownHooks();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Rail Austria API")
      .setDescription(
        "NestJS backend. Times are UTC; delays are seconds. Authentication uses JWT and signed CSRF cookies.",
      )
      .setVersion("1.0.0")
      .addBearerAuth()
      .build(),
  );
  // Attach a stable error response to every operation, including validation and authorization failures.
  for (const path of Object.values(document.paths))
    for (const op of Object.values(path ?? {}) as any[])
      if (op && typeof op === "object" && op.responses)
        for (const status of [400, 401, 403, 404, 409, 429])
          op.responses[status] ??= {
            description: "Structured API error",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["statusCode", "code", "message", "requestId"],
                  properties: {
                    statusCode: { type: "integer" },
                    code: { type: "string" },
                    message: { type: "string" },
                    requestId: { type: "string" },
                    fieldErrors: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          field: { type: "string" },
                          code: { type: "string" },
                          message: { type: "string" },
                        },
                      },
                    },
                    details: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          };
  if (process.env.NODE_ENV !== "production")
    SwaggerModule.setup("api/docs", app, document, {
      jsonDocumentUrl: "api/openapi.json",
    });
  return { app, document };
}
