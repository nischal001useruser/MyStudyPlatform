require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');
const multer = require('multer');
const fs = require('fs');
const archiver = require('archiver');
const { promisify } = require('util');
const readFileAsync = promisify(fs.readFile);

const app = express();
const port = process.env.PORT || 3000;

// --- Google OAuth2 Client Setup ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// --- Multer Configuration for File Uploads ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = './uploads/';
        if (!fs.existsSync(uploadDir)){
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});


const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'application/pdf',
        'image/jpeg',
        'image/jpg',
        'image/png',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only common document and image formats are allowed.'));
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// --- Database Setup ---
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        
        // Create users table with email column
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            password TEXT NULL,
            google_id TEXT UNIQUE NULL,
            email TEXT NULL
        )`, (err) => {
            if (err) {
                // Table exists, try to add email column if it doesn't exist
                db.run(`ALTER TABLE users ADD COLUMN email TEXT NULL`, () => {});
            }
        });
        // Ensure ALL required user columns exist
        db.run(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'student'`, () => {});
        db.run(`ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1`, () => {});
        db.run(`ALTER TABLE users ADD COLUMN last_login DATETIME`, () => {});

        
        // Create notes table
        db.run(`CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            title TEXT,
            content TEXT NULL,
            type TEXT DEFAULT 'text',
            file_path TEXT NULL,
            file_type TEXT NULL,
            link_url TEXT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`, (err) => {
            if (err) {
                // Table exists, try to add new columns if they don't exist
                db.run(`ALTER TABLE notes ADD COLUMN type TEXT DEFAULT 'text'`, () => {});
                db.run(`ALTER TABLE notes ADD COLUMN file_path TEXT NULL`, () => {});
                db.run(`ALTER TABLE notes ADD COLUMN file_type TEXT NULL`, () => {});
                db.run(`ALTER TABLE notes ADD COLUMN link_url TEXT NULL`, () => {});
                db.run(`ALTER TABLE notes ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`, () => {});
                console.log('Added new columns to existing notes table');
            }
        });
        
        db.run(`CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            description TEXT,
            completed BOOLEAN DEFAULT 0,
            due_date TEXT NULL,
            category TEXT NULL,
            priority INTEGER DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        db.run(`
        CREATE TABLE IF NOT EXISTS notification_reads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            notification_id INTEGER,
            read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, notification_id)
        )
        `);
    }
});

// --- Middleware ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static('uploads')); // Serve uploaded files
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: process.env.SECRET_KEY,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// Middleware to ensure user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        return next();
    }
    req.session.error = "Please sign in to access the dashboard.";
    res.redirect('/login');
};

// RBAC Middleware (add this function)
function checkRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      return res.redirect('/dashboard'); // Redirect if not matching role
    }
    next();
  };
}

// Example usage for teacher routes (we'll add more below)
app.use('/teacher', checkRole('teacher'));

// --- Middleware to add unreadNotifications to all views ---
app.use((req, res, next) => {
  // default 0 for not-logged-in users
  res.locals.unreadNotifications = 0;

  // if user logged in, compute unread count from DB
  if (!req.session.userId) {
    return next();
  }

  const userId = req.session.userId;

  const sql = `
    SELECT COUNT(*) AS count
    FROM notifications n
    LEFT JOIN notification_reads nr
      ON nr.notification_id = n.id
     AND nr.user_id = ?
    WHERE nr.id IS NULL
    AND (
      target_type = 'all'
      OR target_type = 'student'
      OR (target_type = 'specific' AND (',' || target_ids || ',') LIKE '%,' || ? || ',%')
    )
  `;

  // userId passed twice for the two placeholders
  db.get(sql, [userId, userId], (err, row) => {
    if (err) {
      console.error('Error getting unread notifications:', err);
      res.locals.unreadNotifications = 0;
      return next();
    }
    res.locals.unreadNotifications = row ? row.count : 0;
    next();
  });
});


// --- Helper function to verify Google token ---
async function verifyGoogleToken(token) {
    try {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        return payload;
    } catch (error) {
        console.error("Error verifying Google token:", error.message);
        return null;
    }
}

// --- Routes ---

// Root redirects to login
app.get('/', (req, res) => {
    res.redirect('/login');
});

// Login Page (Google-only)
app.get('/login', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/dashboard');
    }
    res.render('login', { error: req.session.error, GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID });
    req.session.error = null;
});

// Google Login Endpoint
app.post('/google-login', async (req, res) => {
    const { id_token } = req.body;

    if (!id_token) {
        return res.status(400).json({ error: 'ID token missing.' });
    }

    const payload = await verifyGoogleToken(id_token);
    if (!payload) {
        return res.status(401).json({ error: 'Google token verification failed.' });
    }

    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name;

    db.get('SELECT * FROM users WHERE google_id = ?', [googleId], (err, user) => {
        if (err) {
            console.error('Google login DB error:', err.message);
            return res.status(500).json({ error: 'Database error during Google login.' });
        }

        if (user) {
            // Update email if it changed
            db.run('UPDATE users SET email = ? WHERE id = ?', [email, user.id], () => {});
            req.session.userId = user.id;
            req.session.username = user.username;
            req.session.email = email; // Store email in session
            return res.json({ success: true, redirect: '/dashboard' });
        } else {
            db.get('SELECT * FROM users WHERE username = ?', [email], (err, existingUserByEmail) => {
                if(err) {
                     console.error('Google login DB error (check existing email):', err.message);
                     return res.status(500).json({ error: 'Database error during Google login.' });
                }

                if(existingUserByEmail && !existingUserByEmail.google_id) {
                    db.run('UPDATE users SET google_id = ?, email = ? WHERE id = ?', [googleId, email, existingUserByEmail.id], function(updateErr) {
                        if(updateErr) {
                            console.error('Google login DB error (linking account):', updateErr.message);
                            return res.status(500).json({ error: 'Error linking Google account.' });
                        }
                        req.session.userId = existingUserByEmail.id;
                        req.session.username = existingUserByEmail.username;
                        req.session.email = email; // Store email in session
                        return res.json({ success: true, redirect: '/dashboard' });
                    });
                } else {
                    const finalUsername = name || email;
                    db.run('INSERT INTO users (username, google_id, email) VALUES (?, ?, ?)', [finalUsername, googleId, email], function(insertErr) {
                        if (insertErr) {
                            console.error('Google registration DB error:', insertErr.message);
                            return res.status(500).json({ error: 'Error registering new Google user.' });
                        }
                        req.session.userId = this.lastID;
                        req.session.username = finalUsername;
                        req.session.email = email; // Store email in session
                        return res.json({ success: true, redirect: '/dashboard' });
                    });
                }
            });
        }
    });
});

// Dashboard Page
app.get('/dashboard', isAuthenticated, (req, res) => {
    const userId = req.session.userId;
    let notes = [];
    let tasks = [];

    db.all('SELECT * FROM notes WHERE user_id = ?', [userId], (err, fetchedNotes) => {
        if (err) {
            console.error('Error fetching notes:', err.message);
        } else {
            notes = fetchedNotes;
        }

        db.all('SELECT * FROM tasks WHERE user_id = ?', [userId], (err, fetchedTasks) => {
            if (err) {
                console.error('Error fetching tasks:', err.message);
            } else {
                tasks = fetchedTasks;
            }
            res.render('dashboard', { currentPage: 'home', username: req.session.username, notes, tasks });
        });
    });
});

// Sidebar navigation routes
app.get('/focus-mode', isAuthenticated, (req, res) => {
    res.render('focus_mode', { currentPage: 'focus-mode', username: req.session.username });
});

app.get('/my-tasks', isAuthenticated, (req, res) => {
    db.all('SELECT * FROM tasks WHERE user_id = ? ORDER BY completed ASC, priority DESC, due_date ASC, id DESC', [req.session.userId], (err, tasks) => {
        if (err) {
            console.error('Error fetching tasks for my-tasks page:', err.message);
            tasks = [];
        }
        res.render('my_tasks', { currentPage: 'my-tasks', username: req.session.username, tasks: tasks });
    });
});

app.get('/notes-materials', isAuthenticated, (req, res) => {
    db.all('SELECT * FROM notes WHERE user_id = ? ORDER BY created_at DESC', [req.session.userId], (err, notes) => {
        if (err) {
            console.error('Error fetching notes for notes-materials page:', err.message);
            notes = [];
        }
        res.render('notes_materials', { currentPage: 'notes-materials', username: req.session.username, notes: notes });
    });
});

app.get('/ask-a-question', isAuthenticated, (req, res) => {
    res.render('ask_a_question', { currentPage: 'ask-a-question', username: req.session.username });
});

app.get('/study-buddies', isAuthenticated, (req, res) => {
    res.render('study_buddies', { currentPage: 'study-buddies', username: req.session.username });
});

app.get('/leaderboard', isAuthenticated, (req, res) => {
    res.render('leaderboard', { currentPage: 'leaderboard', username: req.session.username });
});

app.get('/settings', isAuthenticated, (req, res) => {
    res.render('settings', { 
        currentPage: 'settings', 
        username: req.session.username,
        email: req.session.email || 'Not available'
    });
});

// --- Notes & Materials Routes ---

// Add Text Note
app.post('/add-note', isAuthenticated, (req, res) => {
    const { title, content } = req.body;
    db.run('INSERT INTO notes (user_id, title, content, type) VALUES (?, ?, ?, ?)', 
        [req.session.userId, title, content, 'text'], 
        function(err) {
            if (err) {
                console.error('Error adding note:', err.message);
                return res.status(500).send('Error adding note.');
            }
            res.redirect('/notes-materials');
        }
    );
});

// Upload File
app.post('/upload-file', isAuthenticated, upload.single('file'), (req, res) => {
    const { title } = req.body;
    
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const fileExtension = req.file.originalname.split('.').pop().toLowerCase();
    const fileTitle = title || req.file.originalname;
    
    db.run('INSERT INTO notes (user_id, title, type, file_path, file_type) VALUES (?, ?, ?, ?, ?)', 
        [req.session.userId, fileTitle, 'file', req.file.filename, fileExtension], 
        function(err) {
            if (err) {
                console.error('Error saving file info:', err.message);
                // Delete uploaded file if database save fails
                fs.unlinkSync('./uploads/' + req.file.filename);
                return res.status(500).send('Error saving file.');
            }
            res.redirect('/notes-materials');
        }
    );
});

// Add Link
app.post('/add-link', isAuthenticated, (req, res) => {
    const { title, link_url } = req.body;
    
    if (!link_url) {
        return res.status(400).send('Link URL is required.');
    }

    const linkTitle = title || link_url;

    db.run('INSERT INTO notes (user_id, title, type, link_url) VALUES (?, ?, ?, ?)', 
        [req.session.userId, linkTitle, 'link', link_url], 
        function(err) {
            if (err) {
                console.error('Error adding link:', err.message);
                return res.status(500).send('Error adding link.');
            }
            res.redirect('/notes-materials');
        }
    );
});

// Download File
app.get('/download-file/:id', isAuthenticated, (req, res) => {
    const noteId = req.params.id;
    
    db.get('SELECT * FROM notes WHERE id = ? AND user_id = ? AND type = ?', 
        [noteId, req.session.userId, 'file'], 
        (err, note) => {
            if (err || !note) {
                console.error('Error fetching file:', err?.message);
                return res.status(404).send('File not found.');
            }
            
            const filePath = './uploads/' + note.file_path;
            if (!fs.existsSync(filePath)) {
                return res.status(404).send('File not found on server.');
            }
            
            res.download(filePath, note.title + '.' + note.file_type);
        }
    );
});

// Delete Note (handles all types including files)
app.post('/delete-note', isAuthenticated, (req, res) => {
    const { id } = req.body;
    
    db.get('SELECT * FROM notes WHERE id = ? AND user_id = ?', [id, req.session.userId], (err, note) => {
        if (err || !note) {
            console.error('Error finding note:', err?.message);
            return res.status(404).send('Note not found.');
        }
        
        // If it's a file, delete the physical file
        if (note.type === 'file' && note.file_path) {
            const filePath = './uploads/' + note.file_path;
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        
        // Delete from database
        db.run('DELETE FROM notes WHERE id = ? AND user_id = ?', [id, req.session.userId], function(err) {
            if (err) {
                console.error('Error deleting note:', err.message);
                return res.status(500).send('Error deleting note.');
            }
            const referrer = req.get('Referer');
            res.redirect(referrer || '/notes-materials');
        });
    });
});

// --- Task Routes ---

// Add Task
app.post('/add-task', isAuthenticated, (req, res) => {
    const { description, due_date, category, priority } = req.body;
    const userId = req.session.userId;

    const parsedPriority = parseInt(priority);
    const validatedPriority = !isNaN(parsedPriority) && parsedPriority >= 0 && parsedPriority <= 3 ? parsedPriority : 0;

    db.run('INSERT INTO tasks (user_id, description, due_date, category, priority) VALUES (?, ?, ?, ?, ?)',
        [userId, description, due_date || null, category || null, validatedPriority],
        function(err) {
            if (err) {
                console.error('Error adding task:', err.message);
                return res.redirect('/my-tasks');
            }
            console.log(`Task added with ID: ${this.lastID}`);
            res.redirect('/my-tasks');
        }
    );
});

// Delete Task
app.post('/delete-task', isAuthenticated, (req, res) => {
    const { id } = req.body;
    db.run('DELETE FROM tasks WHERE id = ? AND user_id = ?', [id, req.session.userId], function(err) {
        if (err) {
            console.error('Error deleting task:', err.message);
            return res.status(500).send('Error deleting task.');
        }
        const referrer = req.get('Referer');
        res.redirect(referrer || '/dashboard');
    });
});

// Toggle Task Completion
app.post('/toggle-task', isAuthenticated, (req, res) => {
    const { id, completed } = req.body;
    const newCompletedStatus = (completed === 'true' || completed === '1') ? 1 : 0;
    db.run('UPDATE tasks SET completed = ? WHERE id = ? AND user_id = ?', [newCompletedStatus, id, req.session.userId], function(err) {
        if (err) {
            console.error('Error toggling task:', err.message);
            return res.status(500).send('Error toggling task.');
        }
        const referrer = req.get('Referer');
        res.redirect(referrer || '/dashboard');
    });
});

// ===== EXPORT USER DATA API =====
app.get('/api/export-data', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.userId;
        
        // Create a zip archive
        const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression
        });

        // Set response headers for zip download
        res.attachment(`study-flow-data-${Date.now()}.zip`);
        archive.pipe(res);

        // 1. Get user profile info
        db.get('SELECT username, google_id, email FROM users WHERE id = ?', [userId], async (err, user) => {
            if (err) {
                console.error('Error fetching user:', err);
                return res.status(500).send('Error exporting data');
            }

            // 2. Get all notes (text, files, links)
            db.all('SELECT * FROM notes WHERE user_id = ?', [userId], async (err, notes) => {
                if (err) {
                    console.error('Error fetching notes:', err);
                    notes = [];
                }

                // 3. Get all tasks
                db.all('SELECT * FROM tasks WHERE user_id = ?', [userId], (err, tasks) => {
                    if (err) {
                        console.error('Error fetching tasks:', err);
                        tasks = [];
                    }

                    // Create main data JSON
                    const userData = {
                        exportDate: new Date().toISOString(),
                        profile: {
                            username: user.username,
                            email: user.email,
                            googleId: user.google_id
                        },
                        statistics: {
                            totalNotes: notes.length,
                            totalTasks: tasks.length,
                            textNotes: notes.filter(n => n.type === 'text').length,
                            files: notes.filter(n => n.type === 'file').length,
                            links: notes.filter(n => n.type === 'link').length
                        },
                        notes: notes.map(note => ({
                            id: note.id,
                            title: note.title,
                            type: note.type,
                            content: note.content,
                            link_url: note.link_url,
                            file_name: note.file_path,
                            created_at: note.created_at
                        })),
                        tasks: tasks
                    };

                    // Add JSON data to zip
                    archive.append(JSON.stringify(userData, null, 2), { 
                        name: 'user-data.json' 
                    });

                    // Add text notes as separate files
                    notes.filter(n => n.type === 'text' && n.content).forEach((note, index) => {
                        archive.append(note.content, {
                            name: `notes/text-notes/${note.title || 'note-' + note.id}.txt`
                        });
                    });

                    // Add links as a text file
                    const linksList = notes
                        .filter(n => n.type === 'link')
                        .map(n => `${n.title}: ${n.link_url}`)
                        .join('\n\n');
                    
                    if (linksList) {
                        archive.append(linksList, {
                            name: 'notes/saved-links.txt'
                        });
                    }

                    // Add uploaded files (PDFs, images)
                    const filePromises = notes
                        .filter(n => n.type === 'file' && n.file_path)
                        .map(note => {
                            return new Promise((resolve, reject) => {
                                const filePath = `./uploads/${note.file_path}`;
                                if (fs.existsSync(filePath)) {
                                    const stream = fs.createReadStream(filePath);
                                    const fileName = `${note.title}.${note.file_type}`;
                                    archive.append(stream, {
                                        name: `notes/files/${fileName}`
                                    });
                                    resolve();
                                } else {
                                    resolve(); // Skip if file doesn't exist
                                }
                            });
                        });

                    // Wait for all files to be added
                    Promise.all(filePromises).then(() => {
                        // Finalize the archive
                        archive.finalize();
                    }).catch(error => {
                        console.error('Error adding files to archive:', error);
                        archive.finalize();
                    });
                });
            });
        });

    } catch (error) {
        console.error('Export error:', error);
        res.status(500).send('Error exporting data');
    }
});

// ===== DELETE ACCOUNT API =====
app.delete('/api/delete-account', isAuthenticated, (req, res) => {
    const userId = req.session.userId;

    // 1. Delete all uploaded files first
    db.all('SELECT file_path FROM notes WHERE user_id = ? AND type = ?', 
        [userId, 'file'], 
        (err, files) => {
            if (!err && files) {
                files.forEach(file => {
                    const filePath = `./uploads/${file.file_path}`;
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                });
            }

            // 2. Delete all notes
            db.run('DELETE FROM notes WHERE user_id = ?', [userId], (err) => {
                if (err) console.error('Error deleting notes:', err);

                // 3. Delete all tasks
                db.run('DELETE FROM tasks WHERE user_id = ?', [userId], (err) => {
                    if (err) console.error('Error deleting tasks:', err);

                    // 4. Finally, delete the user account
                    db.run('DELETE FROM users WHERE id = ?', [userId], (err) => {
                        if (err) {
                            console.error('Error deleting user:', err);
                            return res.status(500).json({ 
                                error: 'Error deleting account' 
                            });
                        }

                        // Destroy session
                        req.session.destroy((err) => {
                            if (err) {
                                console.error('Error destroying session:', err);
                            }
                            res.json({ 
                                success: true, 
                                message: 'Account deleted successfully' 
                            });
                        });
                    });
                });
            });
        }
    );
});

// ===== GET USER STATS API (for displaying on settings page) =====
app.get('/api/user-stats', isAuthenticated, (req, res) => {
    const userId = req.session.userId;

    db.get('SELECT username, google_id, email FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Error fetching user info' });
        }

        // Get notes count
        db.get('SELECT COUNT(*) as count FROM notes WHERE user_id = ?', [userId], (err, notesCount) => {
            // Get tasks count
            db.get('SELECT COUNT(*) as count FROM tasks WHERE user_id = ?', [userId], (err, tasksCount) => {
                res.json({
                    username: user.username,
                    email: user.email,
                    totalNotes: notesCount ? notesCount.count : 0,
                    totalTasks: tasksCount ? tasksCount.count : 0
                });
            });
        });
    });
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
        }
        res.redirect('/login');
    });
});

// Add these routes and middleware to your existing app.js

// Admin authorization middleware
const isAdmin = (req, res, next) => {
    if (req.session.userId) {
        db.get('SELECT * FROM users WHERE id = ?', [req.session.userId], (err, user) => {
            if (err) {
                console.error('Error checking admin status:', err);
                return res.status(500).send('Database error');
            }
            
            // Check if user is super admin
            const SUPER_ADMIN_EMAIL = 'nischalnaharki0@gmail.com';
            if (user && user.email === SUPER_ADMIN_EMAIL) {
                req.isAdmin = true;
                req.isSuperAdmin = true;
                return next();
            }
            
            // Check if user has admin role
            if (user && user.role === 'admin') {
                req.isAdmin = true;
                req.isSuperAdmin = false;
                return next();
            }
            
            return res.status(403).send('Access denied. Admin privileges required.');
        });
    } else {
        res.redirect('/login');
    }
};

// Create admin tables
db.run(`CREATE TABLE IF NOT EXISTS admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER,
    action TEXT,
    target_user_id INTEGER NULL,
    details TEXT NULL,
    ip_address TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(admin_id) REFERENCES users(id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS platform_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER,
    title TEXT,
    type TEXT,
    content TEXT NULL,
    file_path TEXT NULL,
    link_url TEXT NULL,
    target_group TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(admin_id) REFERENCES users(id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER,
    title TEXT,
    message TEXT,
    target_type TEXT,
    target_ids TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(admin_id) REFERENCES users(id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    content TEXT,
    subject TEXT NULL,
    status TEXT DEFAULT 'pending',
    assigned_teacher_id INTEGER NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(assigned_teacher_id) REFERENCES users(id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER,
    teacher_id INTEGER,
    content TEXT,
    rating INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(question_id) REFERENCES questions(id),
    FOREIGN KEY(teacher_id) REFERENCES users(id)
)`);

// Add role column to users if not exists
db.run(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'student'`, () => {});
db.run(`ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1`, () => {});
db.run(`ALTER TABLE users ADD COLUMN last_login DATETIME`, () => {});

// ==== ADMIN DASHBOARD ROUTE ====
app.get('/admin', isAdmin, (req, res) => {
    res.render('admin_dashboard', { 
        currentPage: 'admin',
        username: req.session.username,
        email: req.session.email,
        isSuperAdmin: req.isSuperAdmin
    });
});

// ==== ADMIN API ROUTES ====

// Get all users
app.get('/api/admin/users', isAdmin, (req, res) => {
    const query = `
        SELECT id, username, email, role, google_id, is_active, last_login,
               (SELECT COUNT(*) FROM notes WHERE user_id = users.id) as notes_count,
               (SELECT COUNT(*) FROM tasks WHERE user_id = users.id) as tasks_count
        FROM users
        ORDER BY id DESC
    `;
    
    db.all(query, [], (err, users) => {
        if (err) {
            console.error('Error fetching users:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ users });
    });
});

// Get user details
app.get('/api/admin/users/:id', isAdmin, (req, res) => {
    const userId = req.params.id;
    
    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Get user's notes and tasks
        db.all('SELECT * FROM notes WHERE user_id = ?', [userId], (err, notes) => {
            db.all('SELECT * FROM tasks WHERE user_id = ?', [userId], (err, tasks) => {
                res.json({ 
                    user: {
                        ...user,
                        notes,
                        tasks
                    }
                });
            });
        });
    });
});

// Update user role
app.post('/api/admin/users/:id/role', isAdmin, (req, res) => {
    const userId = req.params.id;
    const { role } = req.body;
    
    const validRoles = ['student', 'freelancer', 'teacher', 'college', 'admin'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }
    
    db.run('UPDATE users SET role = ? WHERE id = ?', [role, userId], function(err) {
        if (err) {
            console.error('Error updating role:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Log the action
        db.run(
            'INSERT INTO admin_logs (admin_id, action, target_user_id, details) VALUES (?, ?, ?, ?)',
            [req.session.userId, 'role_update', userId, `Changed role to ${role}`]
        );
        
        res.json({ success: true, message: 'Role updated successfully' });
    });
});

// Delete user
app.delete('/api/admin/users/:id', isAdmin, (req, res) => {
    const userId = req.params.id;
    
    // Prevent super admin from being deleted
    db.get('SELECT email FROM users WHERE id = ?', [userId], (err, user) => {
        if (user && user.email === 'nischalnaharki0@gmail.com') {
            return res.status(403).json({ error: 'Cannot delete super admin' });
        }
        
        // Delete user's data
        db.run('DELETE FROM notes WHERE user_id = ?', [userId]);
        db.run('DELETE FROM tasks WHERE user_id = ?', [userId]);
        db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            db.run(
                'INSERT INTO admin_logs (admin_id, action, target_user_id) VALUES (?, ?, ?)',
                [req.session.userId, 'user_delete', userId]
            );
            
            res.json({ success: true, message: 'User deleted successfully' });
        });
    });
});

// Get platform statistics
app.get('/api/admin/stats', isAdmin, (req, res) => {
    const stats = {};
    
    // Total users
    db.get('SELECT COUNT(*) as count FROM users', [], (err, result) => {
        stats.totalUsers = result.count;
        
        // Active users (logged in last 7 days)
        db.get(
            'SELECT COUNT(*) as count FROM users WHERE last_login > datetime("now", "-7 days")',
            [],
            (err, result) => {
                stats.activeUsers = result.count;
                
                // Total notes
                db.get('SELECT COUNT(*) as count FROM notes', [], (err, result) => {
                    stats.totalNotes = result.count;
                    
                    // Total tasks
                    db.get('SELECT COUNT(*) as count FROM tasks', [], (err, result) => {
                        stats.totalTasks = result.count;
                        
                        // Questions
                        db.get('SELECT COUNT(*) as count FROM questions', [], (err, result) => {
                            stats.totalQuestions = result ? result.count : 0;
                            
                            // Answers
                            db.get('SELECT COUNT(*) as count FROM answers', [], (err, result) => {
                                stats.totalAnswers = result ? result.count : 0;
                                
                                // New users this week
                                db.get(
                                    'SELECT COUNT(*) as count FROM users WHERE id > (SELECT MAX(id) - 100 FROM users)',
                                    [],
                                    (err, result) => {
                                        stats.newUsersThisWeek = result.count;
                                        
                                        res.json(stats);
                                    }
                                );
                            });
                        });
                    });
                });
            }
        );
    });
});

// Get admin logs
app.get('/api/admin/logs', isAdmin, (req, res) => {
    const query = `
        SELECT admin_logs.*, users.username as admin_name
        FROM admin_logs
        JOIN users ON admin_logs.admin_id = users.id
        ORDER BY created_at DESC
        LIMIT 100
    `;
    
    db.all(query, [], (err, logs) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ logs });
    });
});

// Admin: list platform materials (JSON)
app.get('/api/admin/materials', isAdmin, (req, res) => {
    const query = `
        SELECT platform_materials.*, users.username AS admin_name
        FROM platform_materials
        LEFT JOIN users ON platform_materials.admin_id = users.id
        ORDER BY created_at DESC
    `;
    db.all(query, [], (err, materials) => {
        if (err) {
            console.error('Error fetching platform materials:', err.message);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ materials: materials || [] });
    });
});

// Upload platform material (supports file upload)
app.post('/api/admin/materials', isAdmin, upload.single('material_file'), (req, res) => {
    const { title, type, content, link_url, target_group } = req.body;
    let filePath = null;
    let fileType = null;

    if (req.file) {
        filePath = req.file.filename;
        const parts = req.file.originalname.split('.');
        fileType = parts.length > 1 ? parts.pop().toLowerCase() : null;
    }

    db.run(
        'INSERT INTO platform_materials (admin_id, title, type, content, file_path, link_url, target_group) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.session.userId, title || (req.file ? req.file.originalname : 'Untitled'), type || (req.file ? 'document' : 'note'), content || null, filePath, link_url || null, target_group || 'all'],
        function(err) {
            if (err) {
                console.error('Error saving platform material:', err.message);
                // cleanup uploaded file if DB save failed
                if (filePath && fs.existsSync('./uploads/' + filePath)) {
                    try { fs.unlinkSync('./uploads/' + filePath); } catch(e) {}
                }
                return res.status(500).json({ error: 'Database error' });
            }

            db.run(
                'INSERT INTO admin_logs (admin_id, action, details) VALUES (?, ?, ?)',
                [req.session.userId, 'material_upload', `Uploaded ${type || 'document'}: ${title || req.file?.originalname || 'Untitled'}`]
            );

            res.json({ success: true, message: 'Material uploaded successfully' });
        }
    );
});

// Delete a material
app.delete('/api/admin/materials/:id', isAdmin, (req, res) => {
    const id = req.params.id;
    db.get('SELECT * FROM platform_materials WHERE id = ?', [id], (err, material) => {
        if (err || !material) {
            return res.status(404).json({ error: 'Material not found' });
        }

        // delete physical file if exists
        if (material.file_path) {
            const filePath = './uploads/' + material.file_path;
            if (fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch(e) { console.error('Error deleting file:', e.message); }
            }
        }

        db.run('DELETE FROM platform_materials WHERE id = ?', [id], function(err) {
            if (err) {
                console.error('Error deleting material:', err.message);
                return res.status(500).json({ error: 'Database error' });
            }

            db.run('INSERT INTO admin_logs (admin_id, action, details) VALUES (?, ?, ?)', [req.session.userId, 'material_delete', `Deleted material ID: ${id}`]);

            res.json({ success: true, message: 'Material deleted' });
        });
    });
});

// Download material file
app.get('/download-material/:id', isAuthenticated, (req, res) => {
    const id = req.params.id;
    db.get('SELECT * FROM platform_materials WHERE id = ?', [id], (err, material) => {
        if (err || !material || !material.file_path) {
            return res.status(404).send('File not found');
        }
        const filePath = './uploads/' + material.file_path;
        if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

        res.download(filePath, material.title + (material.file_path.includes('.') ? '' : '.' + (material.file_path.split('.').pop())));
    });
});

// Send notification
app.post('/api/admin/notifications', isAdmin, (req, res) => {
    const { title, message, target_type, target_ids } = req.body;
    
    db.run(
        'INSERT INTO notifications (admin_id, title, message, target_type, target_ids) VALUES (?, ?, ?, ?, ?)',
        [req.session.userId, title, message, target_type, target_ids ? target_ids.join(',') : null],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            res.json({ success: true, message: 'Notification sent successfully' });
        }
    );
});

// Get questions (Help-Me system)
app.get('/api/admin/questions', isAdmin, (req, res) => {
    const query = `
        SELECT questions.*, 
               users.username as student_name,
               teachers.username as teacher_name,
               (SELECT COUNT(*) FROM answers WHERE question_id = questions.id) as answer_count
        FROM questions
        LEFT JOIN users ON questions.user_id = users.id
        LEFT JOIN users as teachers ON questions.assigned_teacher_id = teachers.id
        ORDER BY created_at DESC
        LIMIT 50
    `;
    
    db.all(query, [], (err, questions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ questions });
    });
});

// Assign question to teacher
app.post('/api/admin/questions/:id/assign', isAdmin, (req, res) => {
    const questionId = req.params.id;
    const { teacher_id } = req.body;
    
    db.run(
        'UPDATE questions SET assigned_teacher_id = ?, status = "assigned" WHERE id = ?',
        [teacher_id, questionId],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ success: true, message: 'Question assigned successfully' });
        }
    );
});

// Delete answer
app.delete('/api/admin/answers/:id', isAdmin, (req, res) => {
    const answerId = req.params.id;
    
    db.run('DELETE FROM answers WHERE id = ?', [answerId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        db.run(
            'INSERT INTO admin_logs (admin_id, action, details) VALUES (?, ?, ?)',
            [req.session.userId, 'answer_delete', `Deleted answer ID: ${answerId}`]
        );
        
        res.json({ success: true, message: 'Answer deleted successfully' });
    });
});

// Update last login time
app.post('/api/user/login-timestamp', isAuthenticated, (req, res) => {
    db.run(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
        [req.session.userId],
        (err) => {
            if (err) console.error('Error updating login timestamp:', err);
            res.json({ success: true });
        }
    );
});

// Add these routes to your app.js for students to access platform materials and notifications

// ==== PLATFORM MATERIALS FOR STUDENTS ====

// View platform materials (accessible to all logged-in users)
app.get('/platform-materials', isAuthenticated, (req, res) => {
    const userId = req.session.userId;

    db.get('SELECT role FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) return res.redirect('/dashboard');

        const userRole = user.role || 'student';

        const query = `
            SELECT platform_materials.*, users.username AS admin_name
            FROM platform_materials
            LEFT JOIN users ON platform_materials.admin_id = users.id
            WHERE target_group = 'all' 
               OR target_group = ?
               OR (target_group = 'students' AND ? IN ('student', 'freelancer'))
            ORDER BY created_at DESC
        `;

        db.all(query, [userRole, userRole], (err, materials) => {
            if (err) materials = [];

            res.render('platform_materials', {
                currentPage: 'platform-materials',
                username: req.session.username,
                materials
            });
        });
    });
});


// ==== NOTIFICATIONS FOR STUDENTS ====

// View notifications
app.get('/notifications', isAuthenticated, (req, res) => {
    db.get('SELECT role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user) {
            return res.redirect('/dashboard');
        }
        
        const userRole = user.role || 'student';
        const userId = req.session.userId;
        
        const query = `
            SELECT 
                notifications.*, 
                users.username AS admin_name,
                nr.id AS read_status
            FROM notifications
            LEFT JOIN users 
                ON notifications.admin_id = users.id
            LEFT JOIN notification_reads nr 
                ON nr.notification_id = notifications.id 
               AND nr.user_id = ?
            WHERE target_type = 'all'
               OR (target_type = ? AND ? = ?)
               OR (target_type = 'specific' AND (',' || target_ids || ',') LIKE '%,' || ? || ',%')
            ORDER BY created_at DESC
        `;

        db.all(query, [userId, userRole, userRole, userId], (err, notifications) => {
            if (err) {
                console.error('Error fetching notifications:', err);
                notifications = [];
            }
            
            res.render('notifications', {
                currentPage: 'notifications',
                username: req.session.username,
                notifications: notifications || []
            });
        });
    });
});


// Mark notification as read (optional feature)
app.post('/notifications/:id/read', isAuthenticated, (req, res) => {
    const notificationId = req.params.id;
    const userId = req.session.userId;

    db.run(`
        INSERT OR IGNORE INTO notification_reads (user_id, notification_id)
        VALUES (?, ?)
    `, [userId, notificationId], function(err) {
        if (err) {
            console.error("Error marking as read:", err);
            return res.json({ success: false });
        }
        res.json({ success: true });
    });
});


// ==== API ENDPOINTS FOR REAL-TIME UPDATES ====

// Get unread notification count
app.get('/api/notifications/unread-count', isAuthenticated, (req, res) => {
    db.get('SELECT role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user) {
            return res.json({ count: 0 });
        }
        
        const userRole = user.role || 'student';
        const userId = req.session.userId;
        
        const query = `
            SELECT COUNT(*) as count
            FROM notifications
            WHERE target_type = 'all'
               OR (target_type = ? AND ? = ?)
               OR (target_type = 'specific' AND (',' || target_ids || ',') LIKE '%,' || ? || ',%')
        `;
        app.get('/api/notifications/unread-count', isAuthenticated, (req, res) => {
    const userId = req.session.userId;

        db.get(`
                SELECT COUNT(*) AS count
                FROM notifications n
                LEFT JOIN notification_reads nr
                    ON nr.notification_id = n.id
                AND nr.user_id = ?
                WHERE nr.id IS NULL
            `, [userId], (err, row) => {
                if (err) {
                    console.error("Unread count error:", err);
                    return res.json({ count: 0 });
                }
                res.json({ count: row.count });
            });
        });

        db.get(query, [userRole, 'target_type', userRole, userId], (err, result) => {
            res.json({ count: result ? result.count : 0 });
        });
    });
});

// Get latest materials count
app.get('/api/materials/count', isAuthenticated, (req, res) => {
    db.get('SELECT role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user) {
            return res.json({ count: 0 });
        }
        
        const userRole = user.role || 'student';
        
        const query = `
            SELECT COUNT(*) as count
            FROM platform_materials
            WHERE target_group = 'all' 
               OR target_group = ?
               OR (target_group = 'students' AND ? IN ('student', 'freelancer'))
        `;
        
        db.get(query, [userRole, userRole], (err, result) => {
            res.json({ count: result ? result.count : 0 });
        });
    });
});

// --- Start the server ---
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Open your browser to http://localhost:${port}`);
});