export interface Migration {
  name: string;
  sql: string;
  version: number;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE app_state (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        initial_baseline_at_ms INTEGER NOT NULL CHECK (initial_baseline_at_ms >= 0),
        panel_chat_id INTEGER,
        panel_message_id INTEGER CHECK (panel_message_id IS NULL OR panel_message_id > 0),
        created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
        updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
        CHECK (
          (panel_chat_id IS NULL AND panel_message_id IS NULL)
          OR
          (panel_chat_id IS NOT NULL AND panel_message_id IS NOT NULL)
        )
      ) STRICT;

      CREATE TABLE care_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        procedure_code TEXT NOT NULL CHECK (procedure_code IN ('water', 'food', 'tray')),
        performed_at_ms INTEGER NOT NULL CHECK (performed_at_ms >= 0),
        actor_telegram_user_id INTEGER NOT NULL CHECK (actor_telegram_user_id > 0),
        actor_display_name TEXT NOT NULL CHECK (length(actor_display_name) > 0),
        actor_username TEXT CHECK (actor_username IS NULL OR length(actor_username) > 0),
        confirmation_chat_id INTEGER NOT NULL,
        confirmation_message_id INTEGER CHECK (
          confirmation_message_id IS NULL OR confirmation_message_id > 0
        ),
        created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= performed_at_ms),
        undone_at_ms INTEGER CHECK (
          undone_at_ms IS NULL OR undone_at_ms >= performed_at_ms
        ),
        undone_by_telegram_user_id INTEGER,
        undone_by_display_name TEXT,
        CHECK (
          (
            undone_at_ms IS NULL
            AND undone_by_telegram_user_id IS NULL
            AND undone_by_display_name IS NULL
          )
          OR
          (
            undone_at_ms IS NOT NULL
            AND undone_by_telegram_user_id = actor_telegram_user_id
            AND length(undone_by_display_name) > 0
          )
        )
      ) STRICT;

      CREATE INDEX idx_care_events_active_by_procedure
        ON care_events (procedure_code, performed_at_ms DESC, id DESC)
        WHERE undone_at_ms IS NULL;

      CREATE TABLE reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        procedure_code TEXT NOT NULL CHECK (procedure_code IN ('water', 'food', 'tray')),
        level TEXT NOT NULL CHECK (level IN ('due', 'overdue')),
        scheduled_for_ms INTEGER NOT NULL CHECK (scheduled_for_ms >= 0),
        sent_at_ms INTEGER NOT NULL CHECK (sent_at_ms >= scheduled_for_ms),
        telegram_chat_id INTEGER NOT NULL,
        telegram_message_id INTEGER NOT NULL CHECK (telegram_message_id > 0),
        closed_at_ms INTEGER CHECK (closed_at_ms IS NULL OR closed_at_ms >= sent_at_ms),
        closed_reason TEXT CHECK (
          closed_reason IS NULL OR closed_reason IN ('completed', 'superseded')
        ),
        closed_by_event_id INTEGER REFERENCES care_events(id),
        CHECK (
          (
            closed_at_ms IS NULL
            AND closed_reason IS NULL
            AND closed_by_event_id IS NULL
          )
          OR
          (
            closed_at_ms IS NOT NULL
            AND (
              (closed_reason = 'completed' AND closed_by_event_id IS NOT NULL)
              OR
              (closed_reason = 'superseded' AND closed_by_event_id IS NULL)
            )
          )
        ),
        UNIQUE (procedure_code, level, scheduled_for_ms)
      ) STRICT;

      CREATE INDEX idx_reminders_open_by_procedure
        ON reminders (procedure_code, sent_at_ms DESC, id DESC)
        WHERE closed_at_ms IS NULL;
    `,
  },
];
