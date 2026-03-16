"""
backend/lab_manager.py — LabManager (Phase 7)

Manages lab team features:
- Invite members via email
- Accept/decline invitations
- List lab members
- Remove members
- Supervisor dashboard data

Lab tier is handled via lab_memberships (Phase 6) and lab_invites (Phase 7).
"""
import json
import logging
import secrets
from datetime import datetime, timezone, timedelta

import backend.db as db
from backend.config import Config

logger = logging.getLogger(__name__)


class LabManager:
    """Stateless — instantiate fresh per request."""

    def invite_member(self, lab_user_id: str, invitee_email: str) -> dict:
        """
        Create an invite for a new lab member.
        Returns: {"success": bool, "invite_token": str, "accept_url": str}
        """
        # Verify inviter is a lab-tier user
        user = db.fetchone(
            "SELECT tier, display_name FROM users WHERE user_id = %s::uuid",
            (lab_user_id,),
        )
        if not user or user.get("tier") not in ("lab", "researcher"):
            return {"success": False, "error": "Only lab users can invite members."}

        # Check for existing pending invite
        existing = db.fetchone(
            """
            SELECT invite_id FROM lab_invites
            WHERE lab_user_id = %s::uuid AND invitee_email = %s
              AND accepted_at IS NULL AND expires_at > NOW()
            """,
            (lab_user_id, invitee_email),
        )
        if existing:
            return {"success": False, "error": "An active invite already exists for this email."}

        # Check max members (10 per lab)
        member_count = db.fetchone(
            "SELECT COUNT(*) as cnt FROM lab_memberships WHERE lab_owner_id = %s::uuid",
            (lab_user_id,),
        )
        if member_count and member_count["cnt"] >= 10:
            return {"success": False, "error": "Lab is at maximum capacity (10 members)."}

        # Create invite
        token = secrets.token_urlsafe(32)
        db.execute(
            """
            INSERT INTO lab_invites (lab_user_id, invite_token, invitee_email)
            VALUES (%s::uuid, %s, %s)
            """,
            (lab_user_id, token, invitee_email),
        )

        accept_url = f"https://{Config.CUSTOM_DOMAIN}/lab/accept?token={token}"

        # Send email
        try:
            from backend.mailer import send_lab_invite_email
            lab_name = user.get("display_name", "A researcher") + "'s Lab"
            send_lab_invite_email(invitee_email, lab_name, accept_url)
        except Exception as exc:
            logger.warning(f"Failed to send lab invite email: {exc}")

        return {"success": True, "invite_token": token, "accept_url": accept_url}

    def accept_invite(self, token: str, user_id: str) -> dict:
        """Accept a lab invitation."""
        invite = db.fetchone(
            """
            SELECT invite_id, lab_user_id, invitee_email, role
            FROM lab_invites
            WHERE invite_token = %s
              AND accepted_at IS NULL
              AND expires_at > NOW()
            """,
            (token,),
        )
        if not invite:
            return {"success": False, "error": "Invalid or expired invitation."}

        # Verify email matches
        user = db.fetchone(
            "SELECT email FROM users WHERE user_id = %s::uuid",
            (user_id,),
        )
        if not user or user["email"].lower() != invite["invitee_email"].lower():
            return {"success": False, "error": "Invitation was sent to a different email address."}

        # Check not already a member
        existing = db.fetchone(
            """
            SELECT id FROM lab_memberships
            WHERE lab_owner_id = %s::uuid AND member_user_id = %s::uuid
            """,
            (str(invite["lab_user_id"]), user_id),
        )
        if existing:
            return {"success": False, "error": "You are already a member of this lab."}

        # Add membership
        db.execute(
            """
            INSERT INTO lab_memberships (lab_owner_id, member_user_id, role)
            VALUES (%s::uuid, %s::uuid, %s)
            """,
            (str(invite["lab_user_id"]), user_id, invite["role"]),
        )

        # Mark invite as accepted
        db.execute(
            "UPDATE lab_invites SET accepted_at = NOW() WHERE invite_id = %s::uuid",
            (str(invite["invite_id"]),),
        )

        # Upgrade member to lab tier if needed
        db.execute(
            "UPDATE users SET tier = 'lab' WHERE user_id = %s::uuid AND tier != 'lab'",
            (user_id,),
        )

        return {"success": True}

    def list_members(self, lab_user_id: str) -> list:
        """List all lab members for a lab owner."""
        rows = db.fetchall(
            """
            SELECT u.user_id, u.display_name, u.email, u.institution,
                   lm.role, lm.joined_at
            FROM lab_memberships lm
            JOIN users u ON u.user_id = lm.member_user_id
            WHERE lm.lab_owner_id = %s::uuid
            ORDER BY lm.joined_at
            """,
            (lab_user_id,),
        )
        return [
            {
                "user_id": str(r["user_id"]),
                "display_name": r.get("display_name", ""),
                "email": r.get("email", ""),
                "institution": r.get("institution", ""),
                "role": r.get("role", "member"),
                "joined_at": str(r.get("joined_at", "")),
            }
            for r in rows
        ]

    def remove_member(self, lab_user_id: str, member_user_id: str) -> dict:
        """Remove a member from the lab."""
        n = db.execute(
            """
            DELETE FROM lab_memberships
            WHERE lab_owner_id = %s::uuid AND member_user_id = %s::uuid
            """,
            (lab_user_id, member_user_id),
        )
        if n and n > 0:
            return {"success": True}
        return {"success": False, "error": "Member not found."}

    def list_pending_invites(self, lab_user_id: str) -> list:
        """List pending invitations."""
        rows = db.fetchall(
            """
            SELECT invite_id, invitee_email, role, created_at, expires_at
            FROM lab_invites
            WHERE lab_user_id = %s::uuid
              AND accepted_at IS NULL
              AND expires_at > NOW()
            ORDER BY created_at DESC
            """,
            (lab_user_id,),
        )
        return [
            {
                "invite_id": str(r["invite_id"]),
                "invitee_email": r["invitee_email"],
                "role": r["role"],
                "created_at": str(r["created_at"]),
                "expires_at": str(r["expires_at"]),
            }
            for r in rows
        ]

    def get_supervisor_data(self, lab_user_id: str) -> dict:
        """Get supervisor dashboard data."""
        members = self.list_members(lab_user_id)
        pending = self.list_pending_invites(lab_user_id)

        # Get recent activity
        member_ids = [m["user_id"] for m in members]
        activity = []
        if member_ids:
            try:
                rows = db.fetchall(
                    """
                    SELECT al.session_id, al.action_type, al.action_data, al.timestamp,
                           u.display_name
                    FROM action_log al
                    JOIN sessions s ON s.session_id = al.session_id
                    JOIN users u ON u.user_id = s.user_id
                    WHERE s.user_id = ANY(%s::uuid[])
                    ORDER BY al.timestamp DESC
                    LIMIT 50
                    """,
                    (member_ids,),
                )
                activity = [
                    {
                        "action": r["action_type"],
                        "user": r.get("display_name", ""),
                        "timestamp": str(r["timestamp"]),
                        "data": r.get("action_data"),
                    }
                    for r in rows
                ]
            except Exception as exc:
                logger.warning(f"Failed to get activity: {exc}")

        # Graph count
        graph_count = 0
        try:
            row = db.fetchone(
                """
                SELECT COUNT(DISTINCT sg.graph_id) as cnt
                FROM session_graphs sg
                JOIN sessions s ON s.session_id = sg.session_id
                WHERE s.user_id = ANY(%s::uuid[])
                """,
                ([lab_user_id] + member_ids,),
            )
            graph_count = row["cnt"] if row else 0
        except Exception:
            pass

        return {
            "members": members,
            "pending_invites": pending,
            "member_count": len(members),
            "recent_activity": activity,
            "total_graphs": graph_count,
        }

    # ── Shareable Graph Links (F6.3) ──────────────────────────────────────

    def create_share_link(
        self,
        graph_id: str,
        user_id: str,
        seed_paper_id: str = "",
        seed_title: str = "",
        view_mode: str = "force",
        view_state: dict = None,
        expires_days: int = None,
    ) -> str:
        """
        Create a shareable link for a graph.
        Returns the share token.
        FIX (GAP-P7-N7): Full schema per PHASE_7.md lines 245-258.
        """
        token = secrets.token_urlsafe(24)
        expires_at = None
        if expires_days:
            expires_at = datetime.now(timezone.utc) + timedelta(days=expires_days)

        db.execute(
            """
            INSERT INTO shared_graphs
              (share_token, graph_id, user_id, seed_paper_id, seed_title,
               view_mode, view_state, expires_at)
            VALUES (%s, %s, %s::uuid, %s, %s, %s, %s::jsonb, %s)
            """,
            (token, graph_id, user_id, seed_paper_id, seed_title,
             view_mode, json.dumps(view_state or {}), expires_at),
        )
        try:
            db.execute(
                "UPDATE graphs SET shared_count = shared_count + 1 WHERE graph_id = %s",
                (graph_id,),
            )
        except Exception:
            pass  # shared_count column may not exist yet
        return token

    def get_share(self, token: str) -> dict | None:
        """Get a share by token. Returns None if expired or not found."""
        row = db.fetchone(
            """
            SELECT share_token, graph_id, user_id::text, seed_paper_id, seed_title,
                   view_mode, view_state, created_at, expires_at, view_count
            FROM shared_graphs
            WHERE share_token = %s
              AND (expires_at IS NULL OR expires_at > NOW())
            """,
            (token,),
        )
        if not row:
            return None
        db.execute(
            "UPDATE shared_graphs SET view_count = view_count + 1, "
            "last_viewed_at = NOW() WHERE share_token = %s",
            (token,),
        )
        return dict(row)

    def list_shares(self, user_id: str) -> list:
        """List all shares for a user."""
        rows = db.fetchall(
            """
            SELECT share_token, graph_id, seed_paper_id, seed_title,
                   view_mode, created_at, expires_at, view_count
            FROM shared_graphs
            WHERE user_id = %s::uuid
            ORDER BY created_at DESC LIMIT 50
            """,
            (user_id,),
        )
        return [dict(r) for r in rows]

    def delete_share(self, token: str, user_id: str) -> bool:
        """Delete a share link."""
        n = db.execute(
            "DELETE FROM shared_graphs WHERE share_token = %s AND user_id = %s::uuid",
            (token, user_id),
        )
        return bool(n and n > 0)
