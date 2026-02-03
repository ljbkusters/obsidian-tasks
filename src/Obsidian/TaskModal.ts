import { type App, setIcon } from 'obsidian';
import { Modal } from 'obsidian';

import EditTask from '../ui/EditTask.svelte';
import type { Task } from '../Task/Task';
import { StatusRegistry } from '../Statuses/StatusRegistry';
import { Status } from '../Statuses/Status';
import { OptionsModal } from './OptionsModal';

export interface TaskModalParams {
    app: App;
    task: Task;
    onSaveSettings: () => Promise<void>;
    onSubmit: (updatedTasks: Task[]) => void;
    allTasks: Task[];
}

export class TaskModal extends Modal {
    public readonly task: Task;
    public readonly onSaveSettings: () => Promise<void>;
    public readonly onSubmit: (updatedTasks: Task[]) => void;
    public readonly allTasks: Task[];

    constructor({ app, task, onSaveSettings, onSubmit, allTasks }: TaskModalParams) {
        super(app);

        this.task = task;
        this.allTasks = allTasks;
        this.onSaveSettings = onSaveSettings;
        this.onSubmit = (updatedTasks: Task[]) => {
            updatedTasks.length && onSubmit(updatedTasks);
            this.close();
        };
    }

    private getMarkdownFiles(): string[] {
        return this.app.vault.getMarkdownFiles().map((e) => e.name);
    }

    private getAllTags() {
        const mdFiles = this.getMarkdownFiles();
        const allTags: Set<string> = new Set<string>();
        mdFiles.forEach((fileName) => {
            const tags = this.app.metadataCache.getCache(fileName)?.tags;
            // loop over all tags and split off the `#`
            tags?.forEach((t) => allTags.add(t.tag.substring(1)));
        });
        // cast to list
        return [...allTags];
    }

    private getAllLinks() {
        return this.getMarkdownFiles().map((e) => e.substring(0, e.length - 3));
    }

    public onOpen(): void {
        this.titleEl.setText('Create or edit Task');
        this.modalEl.style.paddingBottom = '0';

        const optionsButton = document.createElement('button');
        // Add same classes as the default Obsidian modal close button.
        optionsButton.addClasses(['modal-close-button', 'mod-raised', 'clickable-icon']);
        // But overload the 'inset-inline-end' property for a correct position.
        optionsButton.addClass('modal-option-button');
        setIcon(optionsButton, 'settings');
        optionsButton.onclick = () => {
            const optionsModal = new OptionsModal({
                app: this.app,
                onSave: () => {
                    this.onSaveSettings();
                },
            });
            optionsModal.open();
        };
        this.modalEl.appendChild(optionsButton);

        const { contentEl } = this;
        this.contentEl.style.paddingBottom = '0';

        const statusOptions = this.getKnownStatusesAndCurrentTaskStatusIfNotKnown();

        new EditTask({
            target: contentEl,
            props: {
                task: this.task,
                statusOptions: statusOptions,
                onSubmit: this.onSubmit,
                allTasks: this.allTasks,
                allLinks: this.getAllLinks(),
                allTags: this.getAllTags(),
            },
        });
    }

    /**
     * If the task being edited has an unknown status, make sure it is added
     * to the dropdown list.
     * This allows the user to switch to a different status and then change their
     * mind and return to the initial status.
     */
    private getKnownStatusesAndCurrentTaskStatusIfNotKnown() {
        const statusOptions: Status[] = StatusRegistry.getInstance().registeredStatuses;
        if (StatusRegistry.getInstance().bySymbol(this.task.status.symbol) === Status.EMPTY) {
            statusOptions.push(this.task.status);
        }
        return statusOptions;
    }

    public onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
