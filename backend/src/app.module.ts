import { Module, Global, Controller, Get, Inject } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { DatabaseModule, Database } from "./database/database";
import { AuthModule } from "./auth/auth.module";
import { AccessGuard, Public } from "./auth/security";
import { EventsModule } from "./common/events";
import { RailService } from "./rail/rail.service";
import { SchedulesService } from "./rail/schedules.service";
import { RailController } from "./rail/rail.controller";
import { AdminService } from "./admin/admin.service";
import * as admin from "./admin/admin.controller";
import { AccountService } from "./account/account.service";
import { AccountController } from "./account/account.controller";
import { OperationsService } from "./operations/operations.service";
import { OperationsController } from "./operations/operations.controller";
import { MapService } from "./map/map.service";
import { MapController } from "./map/map.controller";
import { RealtimeGateway } from "./map/realtime.gateway";
import { IngestionController } from "./map/ingestion.controller";
import { ImportsService } from "./imports/imports.service";
import { ImportsController } from "./imports/imports.controller";
@Global()
@Module({
  providers: [RailService, SchedulesService],
  controllers: [RailController],
  exports: [RailService, SchedulesService],
})
export class RailModule {}
@Global()
@Module({
  providers: [AdminService],
  controllers: Object.values(admin),
  exports: [AdminService],
})
export class AdminModule {}
@Module({ providers: [AccountService], controllers: [AccountController] })
export class AccountModule {}
@Module({ providers: [OperationsService], controllers: [OperationsController] })
export class OperationsModule {}
@Module({
  providers: [MapService, RealtimeGateway],
  controllers: [MapController, IngestionController],
})
export class MapModule {}
@Module({ providers: [ImportsService], controllers: [ImportsController] })
export class ImportsModule {}
@Public()
@Controller("health")
class HealthController {
  constructor(@Inject(Database) private db: Database) {}
  @Get("live") live() {
    return { status: "ok" };
  }
  @Get("ready") async ready() {
    await this.db.query("SELECT 1");
    return { status: "ok" };
  }
}
@Module({
  imports: [
    DatabaseModule,
    EventsModule,
    AuthModule,
    RailModule,
    AdminModule,
    AccountModule,
    OperationsModule,
    MapModule,
    ImportsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AccessGuard }],
  controllers: [HealthController],
})
export class AppModule {}
