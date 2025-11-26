app.get('/api/notifications/unread-count', (req, res) => {
    const userId = req.session.user?.id;
    if (!userId) return res.json({ count: 0 });

    const sql = `
        SELECT COUNT(*) AS unread
        FROM notifications n
        WHERE
            n.id NOT IN (
                SELECT notification_id
                FROM notification_reads
                WHERE user_id = ?
            )
        AND (
            target_type = 'all'
            OR (target_type = 'student')
            OR (target_type = 'specific' AND (',' || target_ids || ',') LIKE '%,' || ? || ',%')
        )
    `;

    db.get(sql, [userId, userId], (err, row) => {
        if (err) {
            console.error("Unread count error:", err);
            return res.json({ count: 0 });
        }
        res.json({ count: row.unread });
    });
});

function updateUnreadBadge() {
    fetch('/api/notifications/unread-count')
        .then(res => res.json())
        .then(data => {
            const badge = document.getElementById("notif-badge");
            if (!badge) return;

            if (data.count > 0) {
                badge.textContent = data.count;
                badge.style.display = "inline-flex";
            } else {
                badge.style.display = "none";
            }
        });
}

window.onload = updateUnreadBadge;
setInterval(updateUnreadBadge, 60000);

