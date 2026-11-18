CREATE TABLE IF NOT EXISTS courses (name TEXT PRIMARY KEY, metadata TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS course_holes (
  course TEXT NOT NULL, tees TEXT NOT NULL, hole INTEGER NOT NULL CHECK(hole BETWEEN 1 AND 18),
  par INTEGER NOT NULL CHECK(par BETWEEN 3 AND 6), length INTEGER, handicap INTEGER,
  PRIMARY KEY(course, tees, hole));
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY, played_on TEXT NOT NULL, player TEXT NOT NULL, course TEXT NOT NULL,
  round_number INTEGER NOT NULL CHECK(round_number > 0), notes TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(played_on, player, course, round_number));
CREATE TABLE IF NOT EXISTS hole_scores (
  round_id TEXT NOT NULL, hole INTEGER NOT NULL CHECK(hole BETWEEN 1 AND 18),
  tees TEXT NOT NULL, score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 40), par INTEGER NOT NULL CHECK(par BETWEEN 3 AND 6),
  length INTEGER, handicap INTEGER, fir INTEGER CHECK(fir IN (0,1)), green TEXT CHECK(green IN ('miss','gir','sgir')),
  PRIMARY KEY(round_id, hole));
CREATE INDEX IF NOT EXISTS hole_scores_round ON hole_scores(round_id);
CREATE TABLE IF NOT EXISTS revisions (round_id TEXT NOT NULL, revision INTEGER NOT NULL, saved_at TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(round_id, revision));
CREATE TABLE IF NOT EXISTS hole_conditions (round_id TEXT NOT NULL, hole INTEGER NOT NULL, note TEXT NOT NULL, PRIMARY KEY(round_id, hole));
CREATE TABLE IF NOT EXISTS reference_data (name TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS player_rating_categories (player TEXT PRIMARY KEY, category TEXT NOT NULL CHECK(category IN ('M','W')), updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS course_ratings (course TEXT NOT NULL, tees TEXT NOT NULL, gender TEXT NOT NULL, rating REAL NOT NULL, slope INTEGER NOT NULL, par INTEGER, yards INTEGER, source TEXT, PRIMARY KEY(course, tees, gender));
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL);
