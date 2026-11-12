package com.pif.api.auth;

import com.pif.api.data.Db;
import com.pif.api.data.PreferencesRow;
import com.pif.api.data.UserRow;
import java.util.LinkedHashMap;
import java.util.Map;

/** serializeUser of apps/api/src/common/serializers/user.serializer.ts (same keys, order and date format). */
public final class UserJson {

  private UserJson() {}

  public static Map<String, Object> serialize(UserRow user, PreferencesRow prefs) {
    Map<String, Object> m = serializeWithoutPreferences(user);
    m.put("preferences", prefs == null ? null : prefs.toJson());
    return m;
  }

  /** A user loaded without its preferences relation (or includePreferences: false): no "preferences" key at all. */
  public static Map<String, Object> serializeWithoutPreferences(UserRow user) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", user.id().toString());
    m.put("email", user.email());
    m.put("firstName", user.firstName());
    m.put("lastName", user.lastName());
    m.put("role", user.role());
    m.put("experienceLevel", user.experienceLevel());
    m.put("emailVerified", user.emailVerified());
    m.put("emailVerifiedAt", Db.iso(user.emailVerifiedAt()));
    m.put("status", user.status());
    m.put("mfaEnabled", user.mfaEnabled());
    m.put("mfaVerifiedAt", Db.iso(user.mfaVerifiedAt()));
    m.put("createdAt", Db.iso(user.createdAt()));
    m.put("updatedAt", Db.iso(user.updatedAt()));
    m.put("lastLoginAt", Db.iso(user.lastLoginAt()));
    m.put("lastActiveAt", Db.iso(user.lastActiveAt()));
    return m;
  }
}
