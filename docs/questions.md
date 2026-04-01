# Business Logic Questions Log

## 1) Offline-first vs single-node backend limitation  
**Question:** The prompt requires offline-first behavior, but the backend is a single Dockerized service with PostgreSQL. How is offline synchronization handled without distributed infrastructure?  

**My Understanding:** True offline-first requires client-side logic; backend only supports sync endpoints.  

**Solution:**  
Limit implementation to:
- Sync APIs (push/pull changes)
- Versioning fields (updated_at, version)
Do NOT implement full offline engine.

---

## 2) Real-time chat vs backend constraints  
**Question:** The prompt implies real-time chat, but no WebSocket or real-time requirement is explicitly stated in backend constraints.  

**My Understanding:** Real-time is not required for acceptance; only message persistence is.  

**Solution:**  
Implement chat as REST-based message storage:
- Create/read messages
- Read status tracking  
Do NOT implement WebSocket.

---

## 3) File storage handling  
**Question:** Attachments are required, but no external storage is allowed (no S3, etc.).  

**My Understanding:** Files must be stored locally.  

**Solution:**  
- Store files on local disk (e.g., `/uploads`)
- Save file metadata in DB  
Avoid external storage systems.

---

## 4) Payment/refund system absence  
**Question:** Refund rules exist, but no payment integration is defined.  

**My Understanding:** Real payment systems are out of scope.  

**Solution:**  
- Implement refund logic as status/percentage only  
- No real transaction processing

---

## 5) A/B testing complexity  
**Question:** Full A/B experimentation systems are complex and require tracking infrastructure.  

**My Understanding:** Only deterministic assignment is required.  

**Solution:**  
- Implement user cohort assignment using hash(user_id)
- Store variant assignment  
Do NOT build full experiment analytics engine

---

## 6) Analytics event scale  
**Question:** Event tracking (impression, click, etc.) can grow unbounded.  

**My Understanding:** Full analytics pipeline is out of scope.  

**Solution:**  
- Store basic event logs  
- Provide simple aggregation APIs  
Avoid large-scale analytics optimization

---

## 7) SLA “business hours” calculation  
**Question:** SLA requires “48 business hours,” but implementing full calendar logic is complex.  

**My Understanding:** Simplified version is acceptable.  

**Solution:**  
- Treat SLA as 48 *actual* hours  
- Document simplification clearly

---

## 8) Workflow engine complexity  
**Question:** Conditional workflows with branching and approvals imply a full workflow engine.  

**My Understanding:** Full BPM engine is overkill for this project.  

**Solution:**  
- Implement simplified workflow:
  - Approval steps
  - ALL_REQUIRED / ANY_ONE modes  
Avoid complex dynamic workflow engine

---

## 9) Security questions weakness  
**Question:** Password reset via security questions is insecure.  

**My Understanding:** Must follow prompt but secure it minimally.  

**Solution:**  
- Hash answers  
- Add attempt limits  
Do not redesign authentication system

---

## 10) Tamper-evident audit logs  
**Question:** True tamper-proof logging requires external systems (blockchain, WORM storage).  

**My Understanding:** Only logical tamper-evidence is feasible.  

**Solution:**  
- Implement hash-chain logs  
- Store previous_hash field  
No external audit system

---

## 11) 7-year data retention vs storage limits  
**Question:** Long-term retention is unrealistic for local storage.  

**My Understanding:** Retention policy is declarative, not enforced physically.  

**Solution:**  
- Keep data in DB  
- Document retention policy  
Do not implement archival system

---

## 12) Anti-fraud detection scope  
**Question:** Fraud detection (IP/device bursts) implies advanced monitoring.  

**My Understanding:** Only basic checks are required.  

**Solution:**  
- Log IP/device info  
- Flag suspicious activity  
No ML or advanced detection

---

## 13) Notification system scope  
**Question:** “Offline reminders” and notifications imply push systems.  

**My Understanding:** Backend only stores notifications.  

**Solution:**  
- Implement notification table + APIs  
- Mark as read/unread  
No push notification system

---

## 14) Merchant (lab) integration  
**Question:** Merchants are mentioned but no external APIs allowed.  

**My Understanding:** Merchants are internal users in system.  

**Solution:**  
- Treat merchants as roles  
- Provide APIs for submitting results  
No external integrations

---

## 15) Performance requirement (p95 < 300ms)  
**Question:** Strict performance guarantees require load testing and optimization.  

**My Understanding:** Only reasonable optimization is expected.  

**Solution:**  
- Add DB indexes  
- Optimize queries  
Do not implement advanced scaling

---

# Immediate Action  
Cut scope NOW and implement only what matters:

1. Build core modules:
   - Auth + RBAC  
   - Reservation state machine  
   - Follow-up plans  

2. Add supporting modules:
   - Chat (DB only)  
   - Reviews  
   - Notifications  

3. Ignore or simplify:
   - Real-time systems  
   - External integrations  
   - Advanced analytics  

If you don’t cut scope like this, your project will fail acceptance.