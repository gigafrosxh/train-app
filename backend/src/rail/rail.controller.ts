import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { RailService } from "./rail.service";
import {
  Validate,
  QueryDoc,
  ResponseDoc,
  listOf,
  page,
} from "../common/validation";
import * as s from "./rail.schemas";
@ApiTags("Rail service")
@ApiBearerAuth()
@Controller()
export class RailController {
  constructor(@Inject(RailService) private rail: RailService) {}
  @Get("settings")
  @ResponseDoc(
    z.object({
      activeCountry: z.string(),
      tripGenerationDays: z.number(),
      searchWindow: z.object({ from: z.string(), to: z.string() }),
    }),
  )
  settings() {
    return this.rail.settings();
  }
  @Get("countries") @QueryDoc(page) async countries(
    @Query(new Validate(page)) q: any,
  ) {
    const rows = await this.rail.db.query(
      'SELECT code,names,enabled,data_status AS "dataStatus" FROM countries ORDER BY code',
    );
    return {
      items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      total: rows.length,
      ...q,
    };
  }
  @Get("stations")
  @QueryDoc(s.listQuery)
  @ResponseDoc(listOf(s.station))
  stations(@Query(new Validate(s.listQuery)) q: any) {
    return this.rail.stations(q);
  }
  @Get("stations/:id") @ResponseDoc(s.station) station(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.rail.station(id);
  }
  @Get("stations/:id/departures")
  @QueryDoc(s.boardQuery)
  @ResponseDoc(listOf(s.boardEntry))
  departures(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new Validate(s.boardQuery)) q: any,
  ) {
    return this.rail.board(id, q, "Departure");
  }
  @Get("stations/:id/arrivals")
  @QueryDoc(s.boardQuery)
  @ResponseDoc(listOf(s.boardEntry))
  arrivals(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new Validate(s.boardQuery)) q: any,
  ) {
    return this.rail.board(id, q, "Arrival");
  }
  @Get("lines") @QueryDoc(s.listQuery) @ResponseDoc(listOf(s.line)) lines(
    @Query(new Validate(s.listQuery)) q: any,
  ) {
    return this.rail.lines(q);
  }
  @Get("routes/:id") @ResponseDoc(s.route) route(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.rail.route(id);
  }
  @Get("trips")
  @QueryDoc(s.tripQuery)
  @ResponseDoc(listOf(s.tripSummary))
  trips(@Query(new Validate(s.tripQuery)) q: any) {
    return this.rail.trips(q);
  }
  @Get("trips/:id") @ResponseDoc(s.tripDetail) trip(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.rail.trip(id);
  }
  @Get("connections")
  @QueryDoc(s.connectionQuery)
  @ResponseDoc(listOf(s.connection))
  connections(@Query(new Validate(s.connectionQuery)) q: any) {
    return this.rail.connections(q);
  }
}
