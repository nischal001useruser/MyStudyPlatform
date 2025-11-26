document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const tasksListContainer = document.getElementById('tasks-list-container');
    const noTasksMessage = document.getElementById('no-tasks-message');
    const filterCategorySelect = document.getElementById('filter-category');
    const filterPrioritySelect = document.getElementById('filter-priority');
    const sortBySelect = document.getElementById('sort-by');
    const showCompletedTasksCheckbox = document.getElementById('show-completed-tasks');
    const viewMoreTasksWrapper = tasksListContainer.querySelector('.view-more-tasks-wrapper'); // Select inside tasksListContainer
    const viewAllTasksBtn = document.getElementById('view-all-tasks-btn');

    // Modal elements
    const allTasksModal = document.getElementById('all-tasks-modal');
    const closeModalButton = allTasksModal.querySelector('.close-button');
    const modalTasksList = document.getElementById('modal-tasks-list');
    const noModalTasksMessage = document.getElementById('no-modal-tasks-message');

    const TASKS_LIMIT_MAIN_PAGE = 3; // Limit tasks shown on the main page

    // --- Global Tasks Array ---
    // initialTasks comes from the EJS template
    let allTasks = initialTasks.map(task => ({
        ...task,
        created_at: new Date(task.id) // Simulate creation date for sorting, using id as a rough proxy
    }));

    // --- Task Card Generation Function (Reusable for main and modal) ---
    function createTaskCardHTML(task) {
        const dueDateObj = task.due_date ? new Date(task.due_date) : null;
        const now = new Date();
        now.setHours(0, 0, 0, 0); // Normalize 'now' to start of day for accurate overdue check

        const isOverdue = dueDateObj && dueDateObj < now && !task.completed;
        const formattedDueDate = dueDateObj ? dueDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

        let priorityText = '';
        let priorityClass = '';
        switch (task.priority) {
            case 1: priorityText = 'Low'; priorityClass = 'priority-low'; break;
            case 2: priorityText = 'Medium'; priorityClass = 'priority-medium'; break;
            case 3: priorityText = 'High'; priorityClass = 'priority-high'; break;
            default: priorityText = 'None'; break;
        }

        // NO grid-area styling here anymore, the container handles the grid
        return `
            <div class="card task-item-card ${task.completed ? 'completed' : ''} ${isOverdue ? 'overdue-card' : ''}">
                <div class="task-header">
                    <form action="/toggle-task" method="POST" class="toggle-task-form">
                        <input type="hidden" name="id" value="${task.id}">
                        <input type="hidden" name="completed" value="${!task.completed}">
                        <label class="checkbox-container">
                            <input type="checkbox" onchange="this.form.submit()" ${task.completed ? 'checked' : ''}>
                            <span class="checkmark"></span>
                        </label>
                    </form>
                    <h4 class="task-description">${task.description}</h4>
                    <div class="task-actions">
                        <!-- Edit button (future functionality, placeholder for now) -->
                        <!-- <button class="button icon-button edit-task-btn" title="Edit Task" data-task-id="${task.id}"><span class="material-icons-outlined">edit</span></button> -->
                        <form action="/delete-task" method="POST" class="delete-task-form">
                            <input type="hidden" name="id" value="${task.id}">
                            <button type="submit" class="button icon-button delete-task-btn" title="Delete Task">
                                <span class="material-icons-outlined">delete_outline</span>
                            </button>
                        </form>
                    </div>
                </div>
                <div class="task-details">
                    ${task.due_date ? `
                        <span class="detail-item due-date ${isOverdue ? 'overdue' : ''}">
                            <span class="material-icons-outlined">calendar_today</span>
                            ${formattedDueDate}
                        </span>
                    ` : ''}
                    ${task.category ? `
                        <span class="detail-item category">
                            <span class="material-icons-outlined">label_important_outline</span>
                            ${task.category}
                        </span>
                    ` : ''}
                    ${task.priority > 0 ? `
                        <span class="detail-item priority ${priorityClass}">
                            <span class="material-icons-outlined">priority_high</span>
                            ${priorityText}
                        </span>
                    ` : ''}
                </div>
            </div>
        `;
    }

    // --- Task Rendering Function ---
    function renderTasks(tasksToRender, container, limit = null) {
        // Clear tasks, but keep the viewMoreTasksWrapper if it's the main container
        if (container === tasksListContainer) {
            // Remove all children except viewMoreTasksWrapper
            Array.from(container.children).forEach(child => {
                if (child !== viewMoreTasksWrapper && child !== noTasksMessage) {
                    child.remove();
                }
            });
        } else {
            container.innerHTML = ''; // Clear completely for modal
        }


        // Determine if the 'View More' button should be shown
        // The button shows if we are on the main task list AND there are more tasks than the limit
        const shouldShowViewMoreButton = (container === tasksListContainer && tasksToRender.length > TASKS_LIMIT_MAIN_PAGE);

        if (tasksToRender.length === 0) {
            if (container === tasksListContainer) {
                noTasksMessage.style.display = 'block';
            } else if (container === modalTasksList) {
                noModalTasksMessage.style.display = 'block';
            }
            viewMoreTasksWrapper.style.display = 'none'; // Always hide if no tasks or modal
            return;
        } else {
            if (container === tasksListContainer) {
                noTasksMessage.style.display = 'none';
            } else if (container === modalTasksList) {
                noModalTasksMessage.style.display = 'none';
            }
        }

        const displayTasks = limit ? tasksToRender.slice(0, limit) : tasksToRender;

        displayTasks.forEach((task) => { // Removed index here as it's not needed for grid-area
            // Insert task card HTML before the viewMoreTasksWrapper if in the main container
            if (container === tasksListContainer) {
                viewMoreTasksWrapper.insertAdjacentHTML('beforebegin', createTaskCardHTML(task));
            } else {
                container.insertAdjacentHTML('beforeend', createTaskCardHTML(task));
            }
        });

        // --- Handle View More button visibility ---
        if (container === tasksListContainer) { // Only affects the main tasks list container
            if (shouldShowViewMoreButton) {
                viewMoreTasksWrapper.style.display = 'flex'; // Show it as flex in its grid area
            } else {
                viewMoreTasksWrapper.style.display = 'none'; // Hide it
            }
        }
    }

    // --- Filtering and Sorting Logic ---
    function applyFiltersAndSort() {
        let filteredTasks = [...allTasks]; // Start with a copy of all tasks

        // 1. Filter by Completion Status
        if (!showCompletedTasksCheckbox.checked) {
            filteredTasks = filteredTasks.filter(task => !task.completed);
        }

        // 2. Filter by Category
        const selectedCategory = filterCategorySelect.value;
        if (selectedCategory !== 'all') {
            filteredTasks = filteredTasks.filter(task => task.category === selectedCategory);
        }

        // 3. Filter by Priority
        const selectedPriority = filterPrioritySelect.value;
        if (selectedPriority !== 'all') {
            filteredTasks = filteredTasks.filter(task => task.priority === parseInt(selectedPriority));
        }

        // 4. Sort
        const sortBy = sortBySelect.value;
        filteredTasks.sort((a, b) => {
            // Completed tasks at the end, unless sorting explicitly by completion status (not implemented here)
            if (a.completed && !b.completed && !showCompletedTasksCheckbox.checked) return 1;
            if (!a.completed && b.completed && !showCompletedTasksCheckbox.checked) return -1;

            switch (sortBy) {
                case 'due_date_asc':
                    // Tasks without due date come last in asc, first in desc
                    if (!a.due_date && b.due_date) return 1;
                    if (a.due_date && !b.due_date) return -1;
                    if (!a.due_date && !b.due_date) return 0;
                    return new Date(a.due_date) - new Date(b.due_date);
                case 'due_date_desc':
                    if (!a.due_date && b.due_date) return -1; // If A has no due date, B comes first
                    if (a.due_date && !b.due_date) return 1;  // If B has no due date, A comes first
                    if (!a.due_date && !b.due_date) return 0;
                    return new Date(b.due_date) - new Date(a.due_date);
                case 'priority_desc':
                    return b.priority - a.priority;
                case 'priority_asc':
                    return a.priority - b.priority;
                case 'created_desc':
                    return b.id - a.id; // Using ID as a proxy for creation date (assuming auto-increment)
                case 'created_asc':
                    return a.id - b.id; // Using ID as a proxy for creation date
                default:
                    return 0; // No specific sort
            }
        });

        // Render for main page (limited)
        renderTasks(filteredTasks, tasksListContainer, TASKS_LIMIT_MAIN_PAGE);

        // Render for modal (all)
        renderTasks(filteredTasks, modalTasksList);
    }

    // --- Event Listeners for Filters and Sort ---
    filterCategorySelect.addEventListener('change', applyFiltersAndSort);
    filterPrioritySelect.addEventListener('change', applyFiltersAndSort);
    sortBySelect.addEventListener('change', applyFiltersAndSort);
    showCompletedTasksCheckbox.addEventListener('change', applyFiltersAndSort);

    // --- Modal Logic ---
    viewAllTasksBtn.addEventListener('click', (e) => {
        e.preventDefault(); // Prevent default button behavior if it's inside a form
        allTasksModal.style.display = 'block';
        // Re-render tasks in modal to ensure they are fresh and filtered
        applyFiltersAndSort(); // This will call renderTasks for modalTasksList with no limit
    });

    closeModalButton.addEventListener('click', () => {
        allTasksModal.style.display = 'none';
    });

    // Close modal if clicking outside the content
    window.addEventListener('click', (event) => {
        if (event.target == allTasksModal) {
            allTasksModal.style.display = 'none';
        }
    });

    // Initial render of tasks when the page loads
    applyFiltersAndSort();
});