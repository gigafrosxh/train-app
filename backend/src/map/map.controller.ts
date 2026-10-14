import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MapService } from "./map.service";
import { QueryDoc, ResponseDoc, Validate } from "../common/validation";
import * as s from "./map.schemas";
@ApiTags("Map")
@ApiBearerAuth()
@Controller()
export class MapController {
  constructor(@Inject(MapService) private map: MapService) {}
  @Get("map/railways")
  @QueryDoc(s.railwayQuery)
  @ResponseDoc(s.featureCollection)
  railways(@Query(new Validate(s.railwayQuery)) q: any) {
    return this.map.railways(q);
  }
  @Get("map/trains") @QueryDoc(s.mapQuery) @ResponseDoc(s.snapshot) trains(
    @Query(new Validate(s.mapQuery)) q: any,
    @Req() r: any,
  ) {
    return this.map.trains(q, r.user.id);
  }
  @Get("trips/:id/shape") @ResponseDoc(s.feature) shape(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.map.shape(id);
  }
  @Get("trips/:id/position") @ResponseDoc(s.mapTrain) position(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.map.position(id);
  }
}
