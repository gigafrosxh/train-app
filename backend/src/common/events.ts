import { Global, Injectable, Module } from "@nestjs/common";
import { EventEmitter } from "node:events";
@Injectable()
export class Events extends EventEmitter {}
@Global()
@Module({ providers: [Events], exports: [Events] })
export class EventsModule {}
