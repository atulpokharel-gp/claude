-- The list of free/consumer and disposable mailbox providers used to classify a
-- sign-up as an individual (lib/email-kind.ts). Kept as data in its own table,
-- not hardcoded in the app, so it can be extended without a code change. It's
-- global reference data (no msp_id, no row-level security); every tenant reads
-- it, only the DB owner writes it.
create table consumer_email_domains (
  domain     text primary key check (domain = lower(domain) and position('@' in domain) = 0),
  kind       text not null default 'consumer' check (kind in ('consumer', 'disposable')),
  created_at timestamptz not null default now()
);

grant select on consumer_email_domains to zinloop_app;

insert into consumer_email_domains (domain, kind) values
  ('gmail.com','consumer'), ('googlemail.com','consumer'),
  ('outlook.com','consumer'), ('outlook.co.uk','consumer'), ('hotmail.com','consumer'), ('hotmail.co.uk','consumer'), ('hotmail.fr','consumer'),
  ('live.com','consumer'), ('live.co.uk','consumer'), ('msn.com','consumer'), ('windowslive.com','consumer'),
  ('yahoo.com','consumer'), ('yahoo.co.uk','consumer'), ('yahoo.co.in','consumer'), ('yahoo.fr','consumer'), ('yahoo.de','consumer'),
  ('ymail.com','consumer'), ('rocketmail.com','consumer'), ('aol.com','consumer'),
  ('icloud.com','consumer'), ('me.com','consumer'), ('mac.com','consumer'),
  ('proton.me','consumer'), ('protonmail.com','consumer'), ('pm.me','consumer'),
  ('gmx.com','consumer'), ('gmx.net','consumer'), ('gmx.de','consumer'), ('mail.com','consumer'), ('zoho.com','consumer'),
  ('yandex.com','consumer'), ('yandex.ru','consumer'), ('fastmail.com','consumer'), ('hey.com','consumer'),
  ('tutanota.com','consumer'), ('tuta.io','consumer'), ('tutamail.com','consumer'), ('hushmail.com','consumer'),
  ('qq.com','consumer'), ('163.com','consumer'), ('126.com','consumer'), ('sina.com','consumer'), ('foxmail.com','consumer'),
  ('naver.com','consumer'), ('daum.net','consumer'), ('hanmail.net','consumer'),
  ('web.de','consumer'), ('t-online.de','consumer'), ('freenet.de','consumer'),
  ('orange.fr','consumer'), ('free.fr','consumer'), ('laposte.net','consumer'), ('wanadoo.fr','consumer'),
  ('libero.it','consumer'), ('virgilio.it','consumer'),
  ('comcast.net','consumer'), ('verizon.net','consumer'), ('sbcglobal.net','consumer'), ('att.net','consumer'),
  ('cox.net','consumer'), ('bellsouth.net','consumer'), ('btinternet.com','consumer'), ('rediffmail.com','consumer'),
  ('mail.ru','consumer'), ('inbox.com','consumer'),
  ('mailinator.com','disposable'), ('guerrillamail.com','disposable'), ('10minutemail.com','disposable'), ('yopmail.com','disposable'),
  ('throwawaymail.com','disposable'), ('tempmail.com','disposable'), ('temp-mail.org','disposable'), ('trashmail.com','disposable'),
  ('sharklasers.com','disposable'), ('getnada.com','disposable'), ('maildrop.cc','disposable'), ('dispostable.com','disposable')
on conflict (domain) do nothing;
