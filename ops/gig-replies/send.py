#!/usr/bin/env python3
"""Send gig replies through Proton Mail Bridge's local SMTP. Dry run unless --send."""
import argparse
import datetime as dt
import getpass
import json
import mimetypes
import os
import pathlib
import re
import smtplib
import ssl
import string
import subprocess
import sys
import time
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid

HERE = pathlib.Path(__file__).resolve().parent
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
DEFAULT_CERTS = ['~/.config/protonmail/bridge-v3/cert.pem', '~/.config/protonmail/bridge/cert.pem']


def load_json(path, default=None):
    p = pathlib.Path(path).expanduser()
    if not p.exists():
        if default is not None:
            return default
        sys.exit(f'missing {p} (copy the .example.json next to it and fill it in)')
    return json.loads(p.read_text())


def parse_reply(path):
    head, _, body = path.read_text().partition('\n\n')
    h = {}
    for line in head.splitlines():
        k, _, v = line.partition(':')
        h[k.strip().lower()] = v.strip()
    return {'id': path.stem, 'headers': h, 'body': body.rstrip() + '\n'}


def fill(tpl, fields):
    names = {f for _, f, _, _ in string.Formatter().parse(tpl) if f}
    missing = sorted(n for n in names if not str(fields.get(n) or '').strip())
    return (None if missing else tpl.format_map(fields)), missing


def resolve(base, p):
    q = pathlib.Path(p).expanduser()
    return q if q.is_absolute() else (base / q)


def plan(reply, prof, prof_dir, to_map, sent, today, args):
    h = reply['headers']
    out = {'id': reply['id'], 'post': h.get('post', ''), 'note': h.get('note', '')}
    if reply['id'] in sent and not args.resend:
        return {**out, 'skip': f"already sent {sent[reply['id']]['at']} to {sent[reply['id']]['to']}"}
    exp = h.get('expires')
    if exp and today > dt.date.fromisoformat(exp) and not args.include_expired:
        return {**out, 'skip': f'expired {exp}'}
    if 'car' in h.get('requires', '') and not prof.get('car'):
        return {**out, 'skip': 'needs a car (set "car": true in the profile if you have one)'}
    to = h.get('to') or to_map.get(reply['id'], '')
    if not to:
        return {**out, 'skip': f'no address: tap Reply on the post, then add "{reply["id"]}": "<relay address>" to to.local.json'}
    if not EMAIL_RE.match(to):
        return {**out, 'skip': f'bad address {to!r}'}
    fields = {k: v for k, v in prof.items() if isinstance(v, str)}
    fields['exp'] = (fields.get('exp') or '').strip().rstrip('. ')
    sig_missing = [k for k in ('name', 'phone', 'email') if not str(fields.get(k) or '').strip()]
    fields['sig'] = '' if sig_missing else f"{fields['name']}\n{fields['phone']} · {fields['email']}"
    subject, m1 = fill(h.get('subject', ''), fields)
    body, m2 = fill(reply['body'], fields)
    missing = sorted({x for m in m1 + m2 for x in (sig_missing if m == 'sig' else [m])})
    if missing:
        return {**out, 'skip': 'profile is missing ' + ', '.join(missing)}
    files = []
    for a in [x.strip() for x in h.get('attach', '').split(',') if x.strip()]:
        if a == 'resume':
            want = [prof.get('resume')]
        elif a == 'photo':
            want = (prof.get('photos') or [None])[:1]
        elif a == 'photos':
            want = (prof.get('photos') or [None, None])[:2]
            if len(want) < 2:
                want.append(None)
        else:
            want = [None]
        for w in want:
            f = resolve(prof_dir, w) if w else None
            if not f or not f.is_file():
                return {**out, 'skip': f'attachment "{a}" not found (set it in the profile)'}
            files.append(f)
    return {**out, 'to': to, 'subject': subject, 'body': body, 'files': files}


def build(item, prof):
    msg = EmailMessage()
    msg['From'] = formataddr((prof['name'], prof['email']))
    msg['To'] = item['to']
    msg['Subject'] = item['subject']
    msg['Date'] = formatdate(localtime=True)
    msg['Message-ID'] = make_msgid(domain=prof['email'].split('@')[1])
    msg.set_content(item['body'])
    for f in item['files']:
        ctype = mimetypes.guess_type(f.name)[0] or 'application/octet-stream'
        main, sub = ctype.split('/', 1)
        msg.add_attachment(f.read_bytes(), maintype=main, subtype=sub, filename=f.name)
    return msg


def bridge_password(args):
    if os.environ.get('BRIDGE_PASSWORD'):
        return os.environ['BRIDGE_PASSWORD']
    if args.pass_entry:
        r = subprocess.run(['pass', 'show', args.pass_entry], capture_output=True, text=True, check=True)
        return r.stdout.splitlines()[0]
    return getpass.getpass('Bridge password (from `info` in protonmail-bridge --cli; not your Proton password): ')


def tls_context(args):
    cands = [args.cafile] if args.cafile else ([os.environ['BRIDGE_CERT']] if os.environ.get('BRIDGE_CERT') else DEFAULT_CERTS)
    for c in cands:
        p = pathlib.Path(c).expanduser()
        if p.is_file():
            ctx = ssl.create_default_context(cafile=str(p))
            # Trust is pinned to Bridge's own self-signed cert on loopback; its name may not match the host string.
            ctx.check_hostname = False
            return ctx
    sys.exit('Bridge TLS cert not found. Export it from Bridge (Settings > Advanced > Export TLS certificates) and pass --cafile PATH.')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--profile', default=str(HERE / 'profile.local.json'))
    ap.add_argument('--to', default=str(HERE / 'to.local.json'), help='id -> relay address for Craigslist posts')
    ap.add_argument('--replies', default=str(HERE / 'replies'))
    ap.add_argument('--only', help='comma-separated ids or number prefixes, e.g. 01,04,10')
    ap.add_argument('--show', action='store_true', help='print each ready message in full')
    ap.add_argument('--send', action='store_true', help='actually send (default is a dry run)')
    ap.add_argument('--yes', action='store_true', help='skip the confirmation prompt')
    ap.add_argument('--resend', action='store_true', help='include ids already in sent.local.json')
    ap.add_argument('--include-expired', action='store_true')
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=1025)
    ap.add_argument('--ssl', action='store_true', help='implicit TLS instead of STARTTLS (if Bridge SMTP is set to SSL)')
    ap.add_argument('--cafile', help='Bridge TLS cert (default: $BRIDGE_CERT or ~/.config/protonmail/bridge-v3/cert.pem)')
    ap.add_argument('--pass-entry', help='read the Bridge password from `pass show ENTRY` (else $BRIDGE_PASSWORD or a prompt)')
    ap.add_argument('--delay', type=float, default=8.0, help='seconds between sends')
    args = ap.parse_args()

    prof_path = pathlib.Path(args.profile).expanduser()
    prof = load_json(prof_path)
    to_map = load_json(args.to, {})
    sent_path = HERE / 'sent.local.json'
    sent = load_json(sent_path, {})
    replies = [parse_reply(p) for p in sorted(pathlib.Path(args.replies).glob('*.txt'))]
    if args.only:
        keys = [k.strip() for k in args.only.split(',') if k.strip()]
        replies = [r for r in replies if any(r['id'] == k or r['id'].startswith(k + '-') for k in keys)]
    today = dt.date.today()
    items = [plan(r, prof, prof_path.parent, to_map, sent, today, args) for r in replies]
    ready = [i for i in items if 'skip' not in i]

    for i in items:
        if 'skip' in i:
            print(f"SKIP   {i['id']}: {i['skip']}")
        else:
            att = ', '.join(f.name for f in i['files']) or 'no attachments'
            print(f"READY  {i['id']} -> {i['to']} | {i['subject']} | {att}")
            if args.show:
                print('\n    ' + i['body'].replace('\n', '\n    ') + '\n')
    print(f'\n{len(ready)} ready, {len(items) - len(ready)} skipped. From: {prof.get("name")} <{prof.get("email")}>')
    if not args.send:
        print('Dry run. Add --show to read the messages, --send to send them.')
        return
    if not ready:
        return
    if not args.yes and input(f'Send {len(ready)} emails through Bridge now? Type "send": ').strip() != 'send':
        print('Nothing sent.')
        return

    ctx = tls_context(args)
    pw = bridge_password(args)
    try:
        smtp = smtplib.SMTP_SSL(args.host, args.port, context=ctx, timeout=60) if args.ssl else smtplib.SMTP(args.host, args.port, timeout=60)
    except OSError as e:
        sys.exit(f'Cannot reach Bridge SMTP at {args.host}:{args.port} ({e}). Is Bridge running? `systemctl --user status protonmail-bridge`')
    ok = 0
    try:
        if not args.ssl:
            smtp.starttls(context=ctx)
        try:
            smtp.login(prof['email'], pw)
        except smtplib.SMTPException as e:
            sys.exit(f'Bridge login failed ({e}). Use the Bridge password from `info` in protonmail-bridge --cli and your Proton address as "email".')
        for n, i in enumerate(ready):
            try:
                msg = build(i, prof)
                smtp.send_message(msg)
                sent[i['id']] = {'to': i['to'], 'at': dt.datetime.now().isoformat(timespec='seconds'), 'message_id': msg['Message-ID']}
                sent_path.write_text(json.dumps(sent, indent=1) + '\n')
                ok += 1
                print(f"SENT   {i['id']} -> {i['to']}")
            except smtplib.SMTPException as e:
                print(f"FAILED {i['id']} -> {i['to']}: {e}")
            if n < len(ready) - 1:
                time.sleep(args.delay)
    finally:
        try:
            smtp.quit()
        except smtplib.SMTPException:
            pass
    print(f'{ok} of {len(ready)} sent. Log: {sent_path}')
    sys.exit(0 if ok == len(ready) else 1)


if __name__ == '__main__':
    main()
