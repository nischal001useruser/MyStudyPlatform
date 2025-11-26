document.addEventListener('DOMContentLoaded', () => {
    const minutesDisplay = document.getElementById('minutes');
    const secondsDisplay = document.getElementById('seconds');
    const startBtn = document.getElementById('start-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const resetBtn = document.getElementById('reset-btn');
    const focusDurationInput = document.getElementById('focus-duration');
    const setDurationBtn = document.getElementById('set-duration-btn');
    const presetBtns = document.querySelectorAll('.preset-btn');
    const progressRing = document.querySelector('.progress-ring-progress');
    const whiteNoiseAudio = document.getElementById('white-noise-audio');
    const playWhiteNoiseBtn = document.getElementById('play-white-noise-btn');
    const stopWhiteNoiseBtn = document.getElementById('stop-white-noise-btn');
    const youtubeLinkInput = document.getElementById('youtube-link-input');
    const loadYoutubeBtn = document.getElementById('load-youtube-btn');
    const youtubePlayerDiv = document.getElementById('youtube-player');
    const sessionCompleteAudio = document.getElementById('session-complete-audio');
    const notificationPopup = document.getElementById('notification-popup');
    const dismissNotificationBtn = document.getElementById('dismiss-notification');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const exitFullscreenBtn = document.getElementById('exit-fullscreen-btn');
    const htmlTag = document.getElementById('html-tag'); // Added this for easier targeting
    const bodyTag = document.body; // Use document.body directly
    const dashboardWrapper = document.getElementById('dashboard-wrapper');
    const timerSectionRedesigned = document.querySelector('.timer-section-redesigned'); // Get the timer section element

    // Focus Insights elements
    const sessionsTodaySpan = document.getElementById('sessions-today');
    const totalFocusHoursSpan = document.getElementById('total-focus-hours');
    const currentStreakSpan = document.getElementById('current-streak');
    const lastFocusedSpan = document.getElementById('last-focused');

    let timer;
    let totalSeconds;
    let secondsLeft;
    let isPaused = false;
    let player; // YouTube player instance
    
    let radius; 
    let circumference;

    // Function to calculate and set progress ring properties
    function setProgressRingProperties() {
        const svg = progressRing.closest('svg');
        if (svg) {
            // Get the actual computed width/height of the SVG's parent container
            const container = svg.parentElement; // timer-circle-container
            if (!container) {
                console.error("SVG's parent container not found!");
                return;
            }
            // Use getBoundingClientRect for more accurate, fractional dimensions
            const containerRect = container.getBoundingClientRect();
            const svgSize = Math.min(containerRect.width, containerRect.height);

            // Calculate radius as 45% of half the effective SVG size
            // The SVG itself is 100% of its container, so its effective size is svgSize
            radius = (svgSize / 2) * 0.90; // 90% diameter relative to container, means 45% radius
            circumference = radius * 2 * Math.PI;

            // Apply these values to both the progress ring and its track
            progressRing.style.strokeDasharray = `${circumference} ${circumference}`;
            progressRing.setAttribute('r', radius); 
            progressRing.setAttribute('cx', svgSize / 2);
            progressRing.setAttribute('cy', svgSize / 2);

            const track = svg.querySelector('.progress-ring-track');
            if (track) {
                track.setAttribute('r', radius);
                track.setAttribute('cx', svgSize / 2);
                track.setAttribute('cy', svgSize / 2);
            }
        }
    }
    
    // Call this initially to set up the progress ring correctly
    setProgressRingProperties();

    // --- Focus Insights Data & Functions ---
    let focusStats = {
        sessionsToday: 0,
        totalFocusSeconds: 0,
        currentStreak: 0, // In days
        lastFocusDate: null // YYYY-MM-DD
    };

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    function loadFocusStats() {
        const storedStats = localStorage.getItem('focusStats');
        if (storedStats) {
            focusStats = JSON.parse(storedStats);
            // Reset sessionsToday if it's a new day
            if (focusStats.lastFocusDate !== today) {
                focusStats.sessionsToday = 0;
                // If last focus was yesterday, continue streak. Otherwise, reset.
                const lastDate = new Date(focusStats.lastFocusDate);
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                yesterday.setHours(0,0,0,0); // Normalize to start of day
                
                // Compare only dates
                const lastDateString = lastDate.toISOString().slice(0, 10);
                const yesterdayString = yesterday.toISOString().slice(0, 10);

                if (lastDateString !== yesterdayString) {
                    focusStats.currentStreak = 0;
                }
            }
        }
        updateFocusStatsDisplay();
    }

    function saveFocusStats() {
        focusStats.lastFocusDate = today;
        localStorage.setItem('focusStats', JSON.stringify(focusStats));
    }

    function updateFocusStatsDisplay() {
        sessionsTodaySpan.textContent = focusStats.sessionsToday;
        totalFocusHoursSpan.textContent = (focusStats.totalFocusSeconds / 3600).toFixed(1);
        currentStreakSpan.textContent = `${focusStats.currentStreak} days`;
        
        if (focusStats.lastFocusDate) {
            const lastDateObj = new Date(focusStats.lastFocusDate + 'T00:00:00'); // Ensure UTC for comparison
            const now = new Date();
            const diffTime = Math.abs(now - lastDateObj);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

            if (focusStats.lastFocusDate === today) {
                lastFocusedSpan.textContent = 'Just now';
            } else if (diffDays === 1) { // yesterday
                lastFocusedSpan.textContent = 'Yesterday';
            } else {
                lastFocusedSpan.textContent = `${diffDays} days ago`;
            }
        } else {
            lastFocusedSpan.textContent = 'Never';
        }
    }

    function completeSession() {
        focusStats.sessionsToday++;
        focusStats.totalFocusSeconds += totalSeconds; // Add duration of completed session

        // Update streak logic
        if (focusStats.lastFocusDate) {
            const lastDate = new Date(focusStats.lastFocusDate);
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            yesterday.setHours(0,0,0,0); // Normalize to start of day

            const lastDateString = lastDate.toISOString().slice(0, 10);
            const yesterdayString = yesterday.toISOString().slice(0, 10);
            
            if (lastDateString === today) {
                // Already focused today, streak unchanged or continued
            } else if (lastDateString === yesterdayString) {
                // Focused yesterday, continue streak
                focusStats.currentStreak++;
            } else {
                // Break in streak
                focusStats.currentStreak = 1; // Start new streak
            }
        } else {
            focusStats.currentStreak = 1; // First session, start streak
        }

        saveFocusStats();
        updateFocusStatsDisplay();
    }

    // --- Timer Functions ---
    function setProgress(percent) {
        // Always call setProgressRingProperties before setting progress if resizing can occur
        setProgressRingProperties(); 
        const offset = circumference - (percent / 100) * circumference;
        progressRing.style.strokeDashoffset = offset;
    }

    function updateDisplay() {
        const minutes = Math.floor(secondsLeft / 60);
        const seconds = secondsLeft % 60;
        minutesDisplay.textContent = String(minutes).padStart(2, '0');
        secondsDisplay.textContent = String(seconds).padStart(2, '0');

        const percent = ((totalSeconds - secondsLeft) / totalSeconds) * 100;
        setProgress(percent);
    }

    function startTimer() {
        if (!timer) {
            totalSeconds = parseInt(focusDurationInput.value) * 60;
            secondsLeft = totalSeconds;
            updateDisplay();
        }

        startBtn.style.display = 'none';
        pauseBtn.style.display = 'inline-flex';

        timer = setInterval(() => {
            if (!isPaused) {
                secondsLeft--;
                if (secondsLeft < 0) {
                    clearInterval(timer);
                    timer = null;
                    sessionCompleteAudio.play();
                    showNotification();
                    completeSession(); // Update insights upon completion
                    resetTimer();
                    // Optionally, toggle back to normal view from fullscreen
                    if (document.fullscreenElement) { // Check Fullscreen API state
                        document.exitFullscreen();
                    }
                    return;
                }
                updateDisplay();
            }
        }, 1000);
    }

    function pauseTimer() {
        isPaused = !isPaused;
        pauseBtn.innerHTML = isPaused ? '<span class="material-icons"></span> Resume' : '<span class="material-icons"></span> Pause';
    }

    function resetTimer() {
        clearInterval(timer);
        timer = null;
        isPaused = false;
        focusDurationInput.value = 25; // Reset to default
        secondsLeft = parseInt(focusDurationInput.value) * 60;
        totalSeconds = secondsLeft; // Reset totalSeconds as well
        updateDisplay();
        startBtn.style.display = 'inline-flex';
        pauseBtn.style.display = 'none';
        pauseBtn.innerHTML = '<span class="material-icons"></span> Pause';
        setProgress(0); // Reset progress ring
    }

    function setDuration(minutes) {
        clearInterval(timer);
        timer = null;
        isPaused = false;
        focusDurationInput.value = minutes;
        secondsLeft = minutes * 60;
        totalSeconds = secondsLeft;
        updateDisplay();
        startBtn.style.display = 'inline-flex';
        pauseBtn.style.display = 'none';
        pauseBtn.innerHTML = '<span class="material-icons"></span> Pause';
        setProgress(0); // Reset progress ring
    }

    // --- Event Listeners ---
    startBtn.addEventListener('click', startTimer);
    pauseBtn.addEventListener('click', pauseTimer);
    resetBtn.addEventListener('click', resetTimer);
    setDurationBtn.addEventListener('click', () => setDuration(parseInt(focusDurationInput.value)));

    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => setDuration(parseInt(btn.dataset.duration)));
    });

    // Initial display setup
    setDuration(parseInt(focusDurationInput.value));
    loadFocusStats(); // Load stats on page load

    // --- White Noise Controls ---
    playWhiteNoiseBtn.addEventListener('click', () => {
        whiteNoiseAudio.play();
        playWhiteNoiseBtn.style.display = 'none';
        stopWhiteNoiseBtn.style.display = 'inline-flex';
    });

    stopWhiteNoiseBtn.addEventListener('click', () => {
        whiteNoiseAudio.pause();
        whiteNoiseAudio.currentTime = 0; // Reset audio
        playWhiteNoiseBtn.style.display = 'inline-flex';
        stopWhiteNoiseBtn.style.display = 'none';
    });

    // --- YouTube Player Controls ---
    function getYouTubeVideoId(url) {
        const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
        const match = url.match(regExp);
        return (match && match[1].length === 11) ? match[1] : null;
    }

    loadYoutubeBtn.addEventListener('click', () => {
        const url = youtubeLinkInput.value;
        const videoId = getYouTubeVideoId(url);

        if (videoId) {
            // Stop white noise if YouTube video is loaded
            if (whiteNoiseAudio && !whiteNoiseAudio.paused) {
                stopWhiteNoiseBtn.click(); 
            }

            if (player) {
                player.loadVideoById(videoId);
            } else {
                // Create player if it doesn't exist
                player = new YT.Player('youtube-player', {
                    videoId: videoId,
                    playerVars: {
                        'autoplay': 1,
                        'controls': 1,
                        'mute': 0, // Start unmuted, user can adjust
                        'loop': 1,
                        'modestbranding': 1,
                        'rel': 0,
                        'playlist': videoId // Required for looping
                    },
                    events: {
                        'onReady': (event) => {
                            event.target.playVideo();
                            youtubePlayerDiv.style.display = 'block';
                        },
                        'onStateChange': (event) => {
                            if (event.data === YT.PlayerState.ENDED) {
                                player.playVideo(); // Loop video if it ends
                            }
                        }
                    }
                });
            }
        } else {
            alert('Please enter a valid YouTube URL.');
        }
    });

    // Initialize YouTube Player API
    // This function will be called by the YouTube IFrame API when it's ready
    window.onYouTubeIframeAPIReady = () => {
        console.log("YouTube IFrame API is ready.");
        // Player will be created on demand when loadYoutubeBtn is clicked
    };

    // --- Session Complete Notification ---
    function showNotification() {
        notificationPopup.classList.add('show');
        setTimeout(() => {
            notificationPopup.classList.remove('show');
        }, 8000); // Notification auto-dismisses after 8 seconds
    }

    dismissNotificationBtn.addEventListener('click', () => {
        notificationPopup.classList.remove('show');
    });

    // --- Fullscreen Mode ---
    function enterFullscreen() {
        if (timerSectionRedesigned.requestFullscreen) {
            timerSectionRedesigned.requestFullscreen();
        } else if (timerSectionRedesigned.mozRequestFullScreen) { /* Firefox */
            timerSectionRedesigned.mozRequestFullScreen();
        } else if (timerSectionRedesigned.webkitRequestFullscreen) { /* Chrome, Safari & Opera */
            timerSectionRedesigned.webkitRequestFullscreen();
        } else if (timerSectionRedesigned.msRequestFullscreen) { /* IE/Edge */
            timerSectionRedesigned.msRequestFullscreen();
        }
    }

    function exitFullscreen() {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.mozCancelFullScreen) { /* Firefox */
            document.mozCancelFullScreen();
        } else if (document.webkitExitFullscreen) { /* Chrome, Safari and Opera */
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) { /* IE/Edge */
            document.msExitFullscreen();
        }
    }

    // Toggle logic based on Fullscreen API state
    function toggleFullscreenState() {
        if (document.fullscreenElement) {
            // Already in fullscreen, apply full-screen specific classes
            htmlTag.classList.add('fullscreen-active');
            bodyTag.classList.add('fullscreen-active');
            fullscreenBtn.style.display = 'none';
            exitFullscreenBtn.style.display = 'inline-flex';
        } else {
            // Not in fullscreen, remove full-screen specific classes
            htmlTag.classList.remove('fullscreen-active');
            bodyTag.classList.remove('fullscreen-active');
            fullscreenBtn.style.display = 'inline-flex';
            exitFullscreenBtn.style.display = 'none';
        }

        // Always recalulate progress ring properties after fullscreen state changes
        // Use a small timeout to ensure DOM reflow happens
        setTimeout(() => {
            setProgressRingProperties();
            if (timer) { // If timer is active, re-set progress
                const percent = ((totalSeconds - secondsLeft) / totalSeconds) * 100;
                setProgress(percent);
            }
        }, 50); 
    }

    // Event listener for when fullscreen state changes
    document.addEventListener('fullscreenchange', toggleFullscreenState);
    document.addEventListener('mozfullscreenchange', toggleFullscreenState);
    document.addEventListener('webkitfullscreenchange', toggleFullscreenState);
    document.addEventListener('msfullscreenchange', toggleFullscreenState);

    fullscreenBtn.addEventListener('click', enterFullscreen);
    exitFullscreenBtn.addEventListener('click', exitFullscreen);

    // Escape key to exit fullscreen (handled by browser's native fullscreen, but good to have)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.fullscreenElement) {
            exitFullscreen();
        }
    });

    // Handle window resize to adjust progress ring
    window.addEventListener('resize', () => {
        // Always recalulate properties on resize, regardless of fullscreen
        // This keeps the progress ring responsive
        setProgressRingProperties(); 
        if (timer) {
            const percent = ((totalSeconds - secondsLeft) / totalSeconds) * 100;
            setProgress(percent);
        }
    });
});