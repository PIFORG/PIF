package com.pif.api.rooms;

import com.pif.api.security.AuthUser;
import com.pif.api.web.JsonBodyCache;
import tools.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/rooms")
@Tag(name = "Market Rooms")
public class MarketRoomsController {

  private final MarketRoomsService rooms;
  private final RoomEventHub hub;
  private final ObjectMapper mapper;

  public MarketRoomsController(MarketRoomsService rooms, RoomEventHub hub, ObjectMapper mapper) {
    this.rooms = rooms;
    this.hub = hub;
    this.mapper = mapper;
  }

  @GetMapping
  @Operation(summary = "List joinable market rooms")
  public Map<String, Object> list(HttpServletRequest req) {
    return rooms.catalog(AuthUser.from(req));
  }

  @PostMapping
  @Operation(summary = "Create a market room")
  public Map<String, Object> create(HttpServletRequest req) {
    return rooms.create(AuthUser.from(req), JsonBodyCache.get(req, mapper));
  }

  @PostMapping("/join")
  @Operation(summary = "Join a room by id or invite code")
  public Map<String, Object> join(HttpServletRequest req) {
    return rooms.join(AuthUser.from(req), JsonBodyCache.get(req, mapper));
  }

  @GetMapping("/{id}")
  @Operation(summary = "Room detail")
  public Map<String, Object> detail(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.detail(AuthUser.from(req), id);
  }

  @PostMapping("/{id}/leave")
  public Map<String, Object> leave(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.leave(AuthUser.from(req), id);
  }

  @PostMapping("/{id}/start")
  public Map<String, Object> start(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.start(AuthUser.from(req), id);
  }

  @PostMapping("/{id}/pause")
  public Map<String, Object> pause(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.pause(AuthUser.from(req), id);
  }

  @PostMapping("/{id}/end")
  public Map<String, Object> end(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.end(AuthUser.from(req), id);
  }

  @PostMapping("/{id}/clock/advance")
  public Map<String, Object> advance(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.advanceClock(AuthUser.from(req), id);
  }

  @GetMapping("/{id}/state")
  public Map<String, Object> state(HttpServletRequest req, @PathVariable("id") UUID id,
      @RequestParam(value = "sinceSeq", defaultValue = "0") long sinceSeq) {
    return rooms.state(AuthUser.from(req), id, sinceSeq);
  }

  @GetMapping(path = "/{id}/events/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  @Operation(summary = "SSE room events (membership required for private rooms)")
  public SseEmitter stream(HttpServletRequest req, @PathVariable("id") UUID id) {
    rooms.detail(AuthUser.from(req), id); // authz
    return hub.subscribe(id);
  }

  @GetMapping("/{id}/market")
  public Map<String, Object> market(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.marketSnapshot(AuthUser.from(req), id);
  }

  @GetMapping("/{id}/portfolio")
  public Map<String, Object> portfolio(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.portfolio(AuthUser.from(req), id);
  }

  @PostMapping("/{id}/orders/preview")
  public Map<String, Object> previewOrder(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.previewOrder(AuthUser.from(req), id, JsonBodyCache.get(req, mapper));
  }

  @PostMapping("/{id}/orders")
  public Map<String, Object> submitOrder(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.submitOrder(AuthUser.from(req), id, JsonBodyCache.get(req, mapper));
  }

  @GetMapping("/{id}/credit")
  public Map<String, Object> creditPreview(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.creditPreview(AuthUser.from(req), id);
  }

  @PostMapping("/{id}/credit/request")
  public Map<String, Object> creditRequest(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.requestCredit(AuthUser.from(req), id, JsonBodyCache.get(req, mapper));
  }

  @PostMapping("/{id}/credit/repay")
  public Map<String, Object> creditRepay(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.repayCredit(AuthUser.from(req), id, JsonBodyCache.get(req, mapper));
  }

  @PostMapping("/{id}/points/convert")
  public Map<String, Object> convert(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.convertPoints(AuthUser.from(req), id, JsonBodyCache.get(req, mapper));
  }

  @PostMapping("/{id}/rewards/claim")
  public Map<String, Object> claim(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.awardLearning(AuthUser.from(req), id, JsonBodyCache.get(req, mapper));
  }

  @GetMapping("/{id}/messages")
  public Map<String, Object> messages(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.messages(AuthUser.from(req), id);
  }

  @PostMapping("/{id}/messages")
  public Map<String, Object> postMessage(HttpServletRequest req, @PathVariable("id") UUID id) {
    return rooms.postMessage(AuthUser.from(req), id, JsonBodyCache.get(req, mapper));
  }
}
