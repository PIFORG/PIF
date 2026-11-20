package com.pif.api.rooms;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** In-process SSE fan-out for room events. Auth is checked before subscribe. */
@Component
public class RoomEventHub {

  private final ConcurrentHashMap<UUID, CopyOnWriteArrayList<SseEmitter>> emitters = new ConcurrentHashMap<>();

  public SseEmitter subscribe(UUID roomId) {
    SseEmitter emitter = new SseEmitter(0L);
    emitters.computeIfAbsent(roomId, id -> new CopyOnWriteArrayList<>()).add(emitter);
    emitter.onCompletion(() -> remove(roomId, emitter));
    emitter.onTimeout(() -> remove(roomId, emitter));
    emitter.onError(e -> remove(roomId, emitter));
    try {
      emitter.send(SseEmitter.event().name("connected").data(Map.of("roomId", roomId.toString())));
    } catch (IOException e) {
      remove(roomId, emitter);
    }
    return emitter;
  }

  public void publish(UUID roomId, String type, Map<String, Object> payload) {
    List<SseEmitter> list = emitters.get(roomId);
    if (list == null || list.isEmpty()) return;
    for (SseEmitter emitter : list) {
      try {
        emitter.send(SseEmitter.event().name(type).data(payload));
      } catch (Exception e) {
        remove(roomId, emitter);
      }
    }
  }

  private void remove(UUID roomId, SseEmitter emitter) {
    List<SseEmitter> list = emitters.get(roomId);
    if (list != null) {
      list.remove(emitter);
      if (list.isEmpty()) emitters.remove(roomId, list);
    }
    try {
      emitter.complete();
    } catch (Exception ignored) {
      // already closed
    }
  }
}
