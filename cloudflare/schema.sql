CREATE TABLE rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  capacity INTEGER,
  priority INTEGER
);

CREATE TABLE classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  size INTEGER,
  allow_switch INTEGER
);

CREATE TABLE course_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER,
  title TEXT,
  week INTEGER,
  weekday INTEGER,
  start_time TEXT,
  end_time TEXT
);

CREATE TABLE assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_instance_id INTEGER,
  room_id INTEGER
);
