// Fresh-profile Thunderbird prefs for Proton Bridge on localhost.
// Copy to <profile>/user.js BEFORE first launch of a clean profile. Do NOT use on a profile with
// existing accounts: mail.accountmanager.accounts below would replace the account list.
// Replace YOU@proton.me. Password is entered in the UI (the Bridge-generated one, from `info`).
user_pref("mail.accountmanager.accounts", "account_pb");
user_pref("mail.accountmanager.defaultaccount", "account_pb");
user_pref("mail.account.account_pb.server", "server_pb");
user_pref("mail.account.account_pb.identities", "id_pb");
user_pref("mail.identity.id_pb.useremail", "YOU@proton.me");
user_pref("mail.identity.id_pb.fullName", "");
user_pref("mail.identity.id_pb.smtpServer", "smtp_pb");
user_pref("mail.server.server_pb.type", "imap");
user_pref("mail.server.server_pb.hostname", "127.0.0.1");
user_pref("mail.server.server_pb.port", 1143);
user_pref("mail.server.server_pb.userName", "YOU@proton.me");
user_pref("mail.server.server_pb.socketType", 2);      // STARTTLS
user_pref("mail.server.server_pb.authMethod", 3);      // normal password
user_pref("mail.server.server_pb.name", "Proton Bridge");
user_pref("mail.smtpservers", "smtp_pb");
user_pref("mail.smtpserver.smtp_pb.hostname", "127.0.0.1");
user_pref("mail.smtpserver.smtp_pb.port", 1025);
user_pref("mail.smtpserver.smtp_pb.username", "YOU@proton.me");
user_pref("mail.smtpserver.smtp_pb.try_ssl", 2);       // STARTTLS
user_pref("mail.smtpserver.smtp_pb.authMethod", 3);
