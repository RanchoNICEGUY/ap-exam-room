import Foundation
import SQLite3

final class HistoryStore {
    private var db: OpaquePointer?
    private let queue = DispatchQueue(label: "ap.exam.room.history.sqlite")
    init() throws {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("AP Exam Room", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        guard sqlite3_open(dir.appendingPathComponent("History.sqlite").path, &db) == SQLITE_OK else { throw failure() }
        _ = sqlite3_exec(db, "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA synchronous=NORMAL;", nil, nil, nil)
        guard sqlite3_exec(db, """
            CREATE TABLE IF NOT EXISTS attempts (exam TEXT, time INTEGER, payload TEXT NOT NULL, PRIMARY KEY(exam,time));
            CREATE TABLE IF NOT EXISTS kv_sync (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
            """, nil, nil, nil) == SQLITE_OK else { throw failure() }
    }
    deinit { sqlite3_close(db) }
    private func failure() -> NSError {
        NSError(domain: "History", code: Int(sqlite3_errcode(db)), userInfo: [NSLocalizedDescriptionKey: String(cString: sqlite3_errmsg(db))])
    }
    func save(_ rows: [[String: Any]]) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "INSERT OR REPLACE INTO attempts VALUES(?,?,?)", -1, &statement, nil) == SQLITE_OK else { throw failure() }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for row in rows {
            guard let exam = row["examId"] as? String, let time = row["time"] as? Int64 else { continue }
            let json = String(decoding: try JSONSerialization.data(withJSONObject: row), as: UTF8.self)
            sqlite3_reset(statement)
            sqlite3_bind_text(statement, 1, exam, -1, transient)
            sqlite3_bind_int64(statement, 2, time)
            sqlite3_bind_text(statement, 3, json, -1, transient)
            guard sqlite3_step(statement) == SQLITE_DONE else { throw failure() }
        }
    }
    func load() throws -> String {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT payload FROM attempts ORDER BY time DESC", -1, &statement, nil) == SQLITE_OK else { throw failure() }
        defer { sqlite3_finalize(statement) }
        var rows: [String] = []
        var status = sqlite3_step(statement)
        while status == SQLITE_ROW {
            if let value = sqlite3_column_text(statement, 0) { rows.append(String(cString: value)) }
            status = sqlite3_step(statement)
        }
        guard status == SQLITE_DONE else { throw failure() }
        return "[" + rows.joined(separator: ",") + "]"
    }

    func delete(examIDs: [String]?) throws {
        guard let examIDs else {
            guard sqlite3_exec(db, "DELETE FROM attempts", nil, nil, nil) == SQLITE_OK else { throw failure() }
            return
        }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "DELETE FROM attempts WHERE exam = ?", -1, &statement, nil) == SQLITE_OK else { throw failure() }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_exec(db, "BEGIN IMMEDIATE", nil, nil, nil) == SQLITE_OK else { throw failure() }
        do {
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            for examID in examIDs {
                guard sqlite3_bind_text(statement, 1, examID, -1, transient) == SQLITE_OK,
                      sqlite3_step(statement) == SQLITE_DONE,
                      sqlite3_reset(statement) == SQLITE_OK else { throw failure() }
            }
            guard sqlite3_exec(db, "COMMIT", nil, nil, nil) == SQLITE_OK else { throw failure() }
        } catch {
            sqlite3_exec(db, "ROLLBACK", nil, nil, nil)
            throw error
        }
    }

    private func loadAttemptsObjects() throws -> [[String: Any]] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT payload FROM attempts ORDER BY time DESC", -1, &statement, nil) == SQLITE_OK else { throw failure() }
        defer { sqlite3_finalize(statement) }
        var list: [[String: Any]] = []
        var status = sqlite3_step(statement)
        while status == SQLITE_ROW {
            if let value = sqlite3_column_text(statement, 0),
               let data = String(cString: value).data(using: .utf8),
               let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                list.append(obj)
            }
            status = sqlite3_step(statement)
        }
        guard status == SQLITE_DONE else { throw failure() }
        return list
    }

    func pullSync(since: Int64) throws -> [String: Any] {
        try queue.sync {
            let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(db, "SELECT k, v, updated_at, deleted FROM kv_sync WHERE updated_at > ?", -1, &statement, nil) == SQLITE_OK else { throw failure() }
            defer { sqlite3_finalize(statement) }
            sqlite3_bind_int64(statement, 1, since)
            var items: [String: [String: Any]] = [:]
            var status = sqlite3_step(statement)
            while status == SQLITE_ROW {
                if let kPtr = sqlite3_column_text(statement, 0),
                   let vPtr = sqlite3_column_text(statement, 1) {
                    let key = String(cString: kPtr)
                    let val = String(cString: vPtr)
                    let updatedAt = sqlite3_column_int64(statement, 2)
                    let deleted = sqlite3_column_int64(statement, 3) != 0
                    items[key] = ["v": val, "updatedAt": updatedAt, "deleted": deleted]
                }
                status = sqlite3_step(statement)
            }
            guard status == SQLITE_DONE else { throw failure() }
            let attempts = since <= 0 ? (try loadAttemptsObjects()) : []
            return ["serverTime": nowMs, "items": items, "attempts": attempts]
        }
    }

    func pushSync(items: [String: [String: Any]], historyRows: [[String: Any]]?) throws -> [String: Any] {
        try queue.sync {
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            guard sqlite3_exec(db, "BEGIN IMMEDIATE", nil, nil, nil) == SQLITE_OK else { throw failure() }
            do {
                var selStmt: OpaquePointer?
                guard sqlite3_prepare_v2(db, "SELECT updated_at FROM kv_sync WHERE k = ?", -1, &selStmt, nil) == SQLITE_OK else { throw failure() }
                defer { sqlite3_finalize(selStmt) }
                var upStmt: OpaquePointer?
                guard sqlite3_prepare_v2(db, "INSERT OR REPLACE INTO kv_sync(k, v, updated_at, deleted) VALUES(?,?,?,?)", -1, &upStmt, nil) == SQLITE_OK else { throw failure() }
                defer { sqlite3_finalize(upStmt) }

                for (key, entry) in items {
                    let val = (entry["v"] as? String) ?? ""
                    let incomingTs: Int64 = {
                        if let n = entry["updatedAt"] as? Int64 { return n }
                        if let n = entry["updatedAt"] as? Double { return Int64(n) }
                        if let n = entry["updatedAt"] as? Int { return Int64(n) }
                        return Int64(Date().timeIntervalSince1970 * 1000)
                    }()
                    let deleted: Int64 = ((entry["deleted"] as? Bool) == true) ? 1 : 0

                    sqlite3_reset(selStmt)
                    sqlite3_bind_text(selStmt, 1, key, -1, transient)
                    var existingTs: Int64 = -1
                    if sqlite3_step(selStmt) == SQLITE_ROW {
                        existingTs = sqlite3_column_int64(selStmt, 0)
                    }
                    if incomingTs >= existingTs {
                        sqlite3_reset(upStmt)
                        sqlite3_bind_text(upStmt, 1, key, -1, transient)
                        sqlite3_bind_text(upStmt, 2, val, -1, transient)
                        sqlite3_bind_int64(upStmt, 3, incomingTs)
                        sqlite3_bind_int64(upStmt, 4, deleted)
                        guard sqlite3_step(upStmt) == SQLITE_DONE else { throw failure() }
                    }
                }
                if let historyRows, !historyRows.isEmpty {
                    try save(historyRows)
                }
                guard sqlite3_exec(db, "COMMIT", nil, nil, nil) == SQLITE_OK else { throw failure() }
            } catch {
                sqlite3_exec(db, "ROLLBACK", nil, nil, nil)
                throw error
            }
            return ["ok": true, "serverTime": Int64(Date().timeIntervalSince1970 * 1000)]
        }
    }
}
