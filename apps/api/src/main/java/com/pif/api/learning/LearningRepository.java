package com.pif.api.learning;

import com.pif.api.data.Db;
import com.pif.api.learning.engine.Command;
import com.pif.api.learning.engine.Mastery;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/** JDBC access to the existing learning tables; never creates or alters their schema. */
@Repository
public class LearningRepository {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  public LearningRepository(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc=jdbc; this.json=json; }
  /** Must be a method: @Repository is proxied for exception translation, so a public field would be null on the proxy. */
  public JdbcTemplate jdbc() { return jdbc; }
  public ObjectMapper json() { return json; }
  public record Session(UUID id, UUID userId, String slug, int version, String kind, String status,
      UUID parent, Integer branch, int seq, int step, Long equity, String mode, boolean assisted,
      Instant started, Instant updated, Instant ended) {}
  public record Logged(int seq, Command command, String outcome, int step, Instant created) {}
  static Session session(ResultSet r, int n) throws SQLException {
    return new Session(Db.uuid(r,"id"),Db.uuid(r,"user_id"),r.getString("mission_slug"),r.getInt("mission_version"),
        r.getString("kind"),r.getString("status"),Db.uuid(r,"parent_session_id"),(Integer)r.getObject("branch_from_seq"),
        r.getInt("last_seq"),r.getInt("current_step"),(Long)r.getObject("equity_millimes"),r.getString("mentor_mode"),
        r.getBoolean("assisted"),Db.instant(r,"started_at"),Db.instant(r,"updated_at"),Db.instant(r,"ended_at"));
  }
  Session owned(UUID user, UUID id, boolean lock) {
    var rows=jdbc.query("SELECT * FROM learning_sessions WHERE user_id=? AND id=?"+(lock?" FOR UPDATE":""),LearningRepository::session,user,id);
    return rows.isEmpty()?null:rows.getFirst();
  }
  List<Session> sessions(UUID user) {
    return jdbc.query("SELECT * FROM learning_sessions WHERE user_id=? ORDER BY started_at DESC",LearningRepository::session,user);
  }
  Map<String,Object> parse(String value) { return json.readValue(value,new TypeReference<LinkedHashMap<String,Object>>(){}); }
  String encode(Object value) { return json.writeValueAsString(value); }
  List<Logged> commands(UUID id) {
    return jdbc.query("SELECT * FROM learning_commands WHERE session_id=? ORDER BY seq",(r,n)->new Logged(r.getInt("seq"),
        Command.fromJson(parse(r.getString("payload"))),r.getString("outcome"),r.getInt("step"),Db.instant(r,"created_at")),id);
  }
  List<Mastery.Observation> observations(UUID user) {
    return jdbc.query("SELECT * FROM competency_observations WHERE user_id=? ORDER BY created_at ASC",(r,n)->
        new Mastery.Observation(r.getString("competency"),r.getDouble("score"),r.getDouble("weight"),r.getBoolean("assisted"),
            Db.instant(r,"created_at").toEpochMilli()),user);
  }
  Map<String,Object> assessment(UUID id) {
    var rows=jdbc.query("SELECT result::text,created_at FROM learning_assessments WHERE session_id=?",(r,n)-> {
      var value=parse(r.getString("result")); value.put("createdAt",Db.iso(Db.instant(r,"created_at"))); return value;
    },id);
    return rows.isEmpty()?null:rows.getFirst();
  }
  static Map<String,Object> map(Object... entries) {
    Map<String,Object> m=new LinkedHashMap<>();
    for(int i=0;i<entries.length;i+=2)m.put((String)entries[i],entries[i+1]);
    return m;
  }
}
