<script lang="ts">
    import { onMount } from 'svelte';
    import type { SearchResult } from 'obsidian';
    import { prepareFuzzySearch } from 'obsidian';
    import { defaultEditModalShowSettings } from '../Config/EditModalShowSettings';

    import { TASK_FORMATS, getSettings } from '../Config/Settings';
    import type { Status } from '../Statuses/Status';
    import type { Task } from '../Task/Task';
    import { settingsStore } from './SettingsStore';
    import DateEditor from './DateEditor.svelte';
    import Dependency from './Dependency.svelte';
    import { EditableTask } from './EditableTask';
    import { labelContentWithAccessKey } from './EditTaskHelpers';
    import PriorityEditor from './PriorityEditor.svelte';
    import RecurrenceEditor from './RecurrenceEditor.svelte';
    import StatusEditor from './StatusEditor.svelte';

    // These exported variables are passed in as props by TaskModal.onOpen():
    export let task: Task;
    export let onSubmit: (updatedTasks: Task[]) => void | Promise<void>;
    export let statusOptions: Status[];
    export let allTasks: Task[];
    export let allTags: string[];
    export let allLinks: string[];

    const {
        // NEW_TASK_FIELD_EDIT_REQUIRED
        startDateSymbol,
        scheduledDateSymbol,
        dueDateSymbol,
        cancelledDateSymbol,
        createdDateSymbol,
        doneDateSymbol,
    } = TASK_FORMATS.tasksPluginEmoji.taskSerializer.symbols;

    let descriptionInput: HTMLTextAreaElement;

    let editableTask = EditableTask.fromTask(task, allTasks);

    let isDescriptionValid: boolean = true;

    let isCancelledDateValid: boolean = true;
    let isCreatedDateValid: boolean = true;
    let isDoneDateValid: boolean = true;
    let isDueDateValid: boolean = true;
    let isScheduledDateValid: boolean = true;
    let isStartDateValid: boolean = true;

    let isRecurrenceValid: boolean = true;

    let withAccessKeys: boolean = true;
    let formIsValid: boolean = true;

    let mountComplete = false;

    type FuzzyMatchResult = {
        item: string;
        searchResult: SearchResult | null;
    };
    type FuzzyFragment = {
        text: string;
        bold: boolean;
    };
    let suggestions: FuzzyMatchResult[] = [];
    let activeSuggestionsKind: 'link' | 'tag' | null = null;
    let suggestionsQuery = '';
    let caret = 0;
    let dropdownTop = 0;
    let dropdownLeft = 0;

    /**
     * Takes a FuzzyMatchResult and splits it into a list of FuzzyFragments
     *
     * Takes a FuzzyMatchResult, sees which parts are matched and then
     * assigns a boolean value `true` to all matched substrings, and a
     * boolean value `false` for all substrings which were not matched.
     */
    function fragmentFuzzyMatchResult(result: FuzzyMatchResult): FuzzyFragment[] {
        if (result.searchResult == null) return [{ text: result.item, bold: false }];
        const fragments: FuzzyFragment[] = [];
        let head: number = 0;
        result.searchResult.matches.forEach((match) => {
            if (match[0] != head) {
                // the head is currently not at a match, insert a non-match
                fragments.push({ text: result.item.substring(head, match[0]), bold: false });
            }
            // insert a match
            fragments.push({ text: result.item.substring(match[0], match[1]), bold: true });
            head = match[1]; // potentially need a + 1 here;
        });
        if (head < result.item.length) {
            fragments.push({ text: result.item.substring(head, result.item.length), bold: false });
        }
        return fragments;
    }

    $: accesskey = (key: string) => (withAccessKeys ? key : null);
    $: formIsValid =
        isDueDateValid &&
        isRecurrenceValid &&
        isScheduledDateValid &&
        isStartDateValid &&
        isDescriptionValid &&
        isCancelledDateValid &&
        isCreatedDateValid &&
        isDoneDateValid;
    $: isDescriptionValid = editableTask.description.trim() !== '';

    $: isShownInEditModal = { ...defaultEditModalShowSettings, ...$settingsStore.isShownInEditModal };

    onMount(() => {
        settingsStore.set(getSettings());

        const { provideAccessKeys } = getSettings();
        withAccessKeys = provideAccessKeys;

        mountComplete = true;

        setTimeout(() => {
            descriptionInput.focus();
        }, 10);
    });

    const _onClose = () => {
        onSubmit([]);
    };

    const _onDescriptionKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.isComposing && suggestions.length === 0) {
            e.preventDefault();
            if (formIsValid) _onSubmit();
        }

        if (suggestions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex = (selectedIndex + 1) % suggestions.length;
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex = (selectedIndex - 1 + suggestions.length) % suggestions.length;
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                acceptSuggestion(suggestions[selectedIndex].item);
                return;
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                acceptSuggestion(suggestions[selectedIndex].item);
                return;
            }
            if (e.key === 'Escape') {
                suggestions = [];
                return;
            }
        }
    };

    // this is called, when text is pasted or dropped into
    // the description field, to remove any linebreaks
    const _removeLinebreaksFromDescription = () => {
        // wrapped into a timer to run after the paste/drop event
        setTimeout(() => {
            editableTask.description = editableTask.description.replace(/[\r\n]+/g, ' ');
        }, 0);
    };

    const _onSubmit = async () => {
        const newTasks = await editableTask.applyEdits(task, allTasks);
        onSubmit(newTasks);
    };
    function _autoSuggest(e: Event) {
        // value is already synced via bind:value, but we still read caret
        const el = e.target as HTMLTextAreaElement;
        caret = el.selectionStart ?? 0;

        const ctx = extractTriggerContext(editableTask.description, caret);
        activeSuggestionsKind = ctx?.kind ?? null;
        if (!activeSuggestionsKind) {
            suggestions = [];
            return;
        }

        suggestionsQuery = ctx?.query ?? '';
        switch (activeSuggestionsKind) {
            case 'link':
                suggestions = filterSuggestions(allLinks, suggestionsQuery);
                break;
            case 'tag':
                suggestions = filterSuggestions(allTags, suggestionsQuery);
                break;
            default:
                throw new Error("type must be one of 'link' or 'tag'");
        }
        // display suggestions

        if (suggestions.length > 0) {
            const coords = getRelativeCoordinates(descriptionInput, ctx?.start ?? caret);
            dropdownTop = coords.top + 20;
            dropdownLeft = coords.left;
        }
    }

    function extractTriggerContext(text: string, caret: number) {
        /* Look back from caret to find the nearest trigger that is still “open”
         *  - For links: `[[` not yet closed by `]]`
         *  - For tags: `#` start until a separator (space, punctuation, newline)
         */
        const left = text.slice(0, caret);
        // const right = text.slice(caret);

        // Check for link trigger `[[`
        const openLinkIdx = left.lastIndexOf('[[');
        const closeLinkIdx = left.lastIndexOf(']]');
        if (openLinkIdx !== -1 && openLinkIdx > closeLinkIdx) {
            const after = left.slice(openLinkIdx + 2); // text after [[
            const query = after.replace(/\n/g, '');
            return { kind: 'link' as const, query, start: openLinkIdx + 2, end: caret };
        }

        // Check for tag trigger `#`
        // Find a '#' that is not preceded by another non-space word char (basic heuristic)
        const hashIdx = left.lastIndexOf('#');
        if (hashIdx !== -1) {
            // ensure no whitespace/newline between # and caret
            const afterHash = left.slice(hashIdx + 1);
            if (!afterHash.match(/[\s]/)) {
                const query = afterHash;
                return { kind: 'tag' as const, query, start: hashIdx + 1, end: caret };
            }
        }

        return null;
    }

    function filterSuggestions(candidates: string[], query: string): FuzzyMatchResult[] {
        // handle case where search query is empty string
        if (!query) {
            return candidates.slice(0, 20).map((item) => {
                return { item, searchResult: null };
            });
        }

        const searchFn = prepareFuzzySearch(query);
        return candidates
            .map((item) => {
                const res = searchFn(item);
                return res == null ? null : { item, searchResult: res };
            })
            .filter((x): x is { item: string; searchResult: SearchResult } => x !== null)
            .sort((a, b) => b.searchResult.score - a.searchResult.score)
            .slice(0, 20);
    }

    let selectedIndex = 0;

    function acceptSuggestion(s: string) {
        const ctx = extractTriggerContext(editableTask.description, caret);
        if (!ctx) return;

        const before = editableTask.description.slice(0, ctx.start);
        const after = editableTask.description.slice(ctx.end);

        const inserted = activeSuggestionsKind === 'link' ? `${s}]]` : s;

        editableTask.description = before + inserted + after;

        // move caret after inserted text
        queueMicrotask(() => {
            const pos = before.length + inserted.length;
            descriptionInput.setSelectionRange(pos, pos);
            descriptionInput.focus();
        });

        suggestions = [];
        selectedIndex = 0;
    }

    let mirror: HTMLDivElement;

    /**
     * Creates a mirror element to calculate its position, then
     * calculates relative offset from textarea up to `position`.
     */
    function getRelativeCoordinates(textArea: HTMLTextAreaElement, position: number) {
        const style = getComputedStyle(textArea);
        const props = [
            'box-sizing',
            'width',
            'font-size',
            'font-family',
            'font-weight',
            'font-style',
            'line-height',
            'letter-spacing',
            'text-indent',
            'padding-top',
            'padding-right',
            'padding-bottom',
            'padding-left',
            'border-left-width',
            'border-right-width',
            'border-top-width',
            'border-bottom-width',
            'white-space',
        ];

        props.forEach((prop: string) => {
            const propStyle = style.getPropertyValue(prop);
            mirror.style.setProperty(prop, propStyle);
        });

        const before = textArea.value.substring(0, position);
        const after = textArea.value.substring(position);
        mirror.textContent = before.replace(/\n$/, '\n-');

        const span = document.createElement('span');
        span.textContent = after || '.';
        mirror.appendChild(span);

        const rect = span.getBoundingClientRect();
        mirror.removeChild(span);

        return { top: rect.top, left: rect.left };
    }
</script>

<!--
Availability of access keys:
- A: Start
- B: Before this
- C: Created
- D: Due
- E: After this
- F: Only future dates
- G:
- H: High
- I: Highest
- J:
- K:
- L: Low
- M: Medium
- N: Normal
- O: Lowest
- P:
- Q:
- R: Recurs
- S: Scheduled
- T: Description
- U: Status
- V:
- W:
- X: Done
- Y:
- Z:
- -: Cancelled
-->

<form class="tasks-modal" on:submit|preventDefault={_onSubmit}>
    <!-- NEW_TASK_FIELD_EDIT_REQUIRED -->

    <!-- --------------------------------------------------------------------------- -->
    <!--  Description  -->
    <!-- --------------------------------------------------------------------------- -->
    <section class="tasks-modal-description-section">
        <label for="description">{@html labelContentWithAccessKey('Description', accesskey('t'))}</label>
        <!-- svelte-ignore a11y-accesskey -->

        {#if suggestions.length > 0}
            <ul class="tasks-autocomplete" style="left: {dropdownLeft}px; top: {dropdownTop}px;">
                {#each suggestions as s, i}
                    <li class:selected={i === selectedIndex} on:mousedown={() => acceptSuggestion(s.item)}>
                        {#each fragmentFuzzyMatchResult(s) as f}
                            {#if f.bold}
                                <strong>{f.text}</strong>
                            {:else}
                                {f.text}
                            {/if}
                        {/each}
                    </li>
                {/each}
            </ul>
        {/if}
        <div class="textarea-mirror" bind:this={mirror} />
        <textarea
            bind:value={editableTask.description}
            bind:this={descriptionInput}
            id="description"
            class="tasks-modal-description"
            placeholder="Take out the trash"
            accesskey={accesskey('t')}
            on:input={_autoSuggest}
            on:keydown={_onDescriptionKeyDown}
            on:paste={_removeLinebreaksFromDescription}
            on:drop={_removeLinebreaksFromDescription}
        />
    </section>

    <!-- --------------------------------------------------------------------------- -->
    <!--  Priority  -->
    <!-- --------------------------------------------------------------------------- -->
    {#if isShownInEditModal.priority}
        <section class="tasks-modal-priority-section">
            <PriorityEditor bind:priority={editableTask.priority} {withAccessKeys} />
        </section>
        <hr id="line-after-priority" />
    {/if}

    <!-- --------------------------------------------------------------------------- -->
    <!--  Dates  -->
    <!-- --------------------------------------------------------------------------- -->
    <section class="tasks-modal-dates-section">
        <!-- --------------------------------------------------------------------------- -->
        <!--  Recurrence  -->
        <!-- --------------------------------------------------------------------------- -->
        {#if isShownInEditModal.recurrence}
            <RecurrenceEditor {editableTask} bind:isRecurrenceValid accesskey={accesskey('r')} />
        {/if}
        <!-- --------------------------------------------------------------------------- -->
        <!--  Due Date  -->
        <!-- --------------------------------------------------------------------------- -->
        {#if isShownInEditModal.due}
            <DateEditor
                id="due"
                dateSymbol={dueDateSymbol}
                bind:date={editableTask.dueDate}
                bind:isDateValid={isDueDateValid}
                forwardOnly={editableTask.forwardOnly}
                accesskey={accesskey('d')}
            />
        {/if}

        <!-- --------------------------------------------------------------------------- -->
        <!--  Scheduled Date  -->
        <!-- --------------------------------------------------------------------------- -->
        {#if isShownInEditModal.scheduled}
            <DateEditor
                id="scheduled"
                dateSymbol={scheduledDateSymbol}
                bind:date={editableTask.scheduledDate}
                bind:isDateValid={isScheduledDateValid}
                forwardOnly={editableTask.forwardOnly}
                accesskey={accesskey('s')}
            />
        {/if}

        <!-- --------------------------------------------------------------------------- -->
        <!--  Start Date  -->
        <!-- --------------------------------------------------------------------------- -->
        {#if isShownInEditModal.start}
            <DateEditor
                id="start"
                dateSymbol={startDateSymbol}
                bind:date={editableTask.startDate}
                bind:isDateValid={isStartDateValid}
                forwardOnly={editableTask.forwardOnly}
                accesskey={accesskey('a')}
            />
        {/if}

        <!-- --------------------------------------------------------------------------- -->
        <!--  Only future dates  -->
        <!-- --------------------------------------------------------------------------- -->
        {#if isShownInEditModal.due || isShownInEditModal.scheduled || isShownInEditModal.start}
            <div class="future-dates-only" id="only-future-dates">
                <label for="forwardOnly">{@html labelContentWithAccessKey('Only future dates:', accesskey('f'))}</label>
                <!-- svelte-ignore a11y-accesskey -->
                <input
                    bind:checked={editableTask.forwardOnly}
                    id="forwardOnly"
                    type="checkbox"
                    class="task-list-item-checkbox tasks-modal-checkbox"
                    accesskey={accesskey('f')}
                />
            </div>
        {/if}
    </section>
    {#if isShownInEditModal.due || isShownInEditModal.scheduled || isShownInEditModal.start}
        <hr id="line-after-happens-dates" />
    {/if}

    <!-- --------------------------------------------------------------------------- -->
    <!--  Dependencies  -->
    <!-- --------------------------------------------------------------------------- -->
    <section class="tasks-modal-dependencies-section">
        {#if allTasks.length > 0 && mountComplete}
            <!-- --------------------------------------------------------------------------- -->
            <!--  Blocked By Tasks  -->
            <!-- --------------------------------------------------------------------------- -->
            {#if isShownInEditModal.before_this}
                <Dependency
                    id="before_this"
                    type="blockedBy"
                    labelText="Before this"
                    {task}
                    {editableTask}
                    {allTasks}
                    {_onDescriptionKeyDown}
                    accesskey={accesskey('b')}
                    placeholder="Search for tasks that the task being edited depends on..."
                />
            {/if}

            <!-- --------------------------------------------------------------------------- -->
            <!--  Blocking Tasks  -->
            <!-- --------------------------------------------------------------------------- -->
            {#if isShownInEditModal.after_this}
                <Dependency
                    id="after_this"
                    type="blocking"
                    labelText="After this"
                    {task}
                    {editableTask}
                    {allTasks}
                    {_onDescriptionKeyDown}
                    accesskey={accesskey('e')}
                    placeholder="Search for tasks that depend on this task being done..."
                />
            {/if}
        {:else}
            <div><i>Blocking and blocked by fields are disabled when vault tasks is empty</i></div>
        {/if}
    </section>
    {#if isShownInEditModal.before_this || isShownInEditModal.after_this}
        <hr id="line-after-dependencies" />
    {/if}

    <section class="tasks-modal-dates-section">
        <!-- --------------------------------------------------------------------------- -->
        <!--  Status  -->
        <!-- --------------------------------------------------------------------------- -->
        {#if isShownInEditModal.status}
            <StatusEditor {task} bind:editableTask {statusOptions} accesskey={accesskey('u')} />
        {/if}

        <!-- --------------------------------------------------------------------------- -->
        <!--  Created Date  -->
        <!-- --------------------------------------------------------------------------- -->
        {#if isShownInEditModal.created}
            <DateEditor
                id="created"
                dateSymbol={createdDateSymbol}
                bind:date={editableTask.createdDate}
                bind:isDateValid={isCreatedDateValid}
                forwardOnly={editableTask.forwardOnly}
                accesskey={accesskey('c')}
            />
        {/if}

        <!-- --------------------------------------------------------------------------- -->
        <!--  Done Date  -->
        <!-- --------------------------------------------------------------------------- -->
        {#if isShownInEditModal.done}
            <DateEditor
                id="done"
                dateSymbol={doneDateSymbol}
                bind:date={editableTask.doneDate}
                bind:isDateValid={isDoneDateValid}
                forwardOnly={editableTask.forwardOnly}
                accesskey={accesskey('x')}
            />
        {/if}

        <!-- --------------------------------------------------------------------------- -->
        <!--  Cancelled Date  -->
        <!-- --------------------------------------------------------------------------- -->
        {#if isShownInEditModal.cancelled}
            <DateEditor
                id="cancelled"
                dateSymbol={cancelledDateSymbol}
                bind:date={editableTask.cancelledDate}
                bind:isDateValid={isCancelledDateValid}
                forwardOnly={editableTask.forwardOnly}
                accesskey={accesskey('-')}
            />
        {/if}
    </section>

    <section class="tasks-modal-button-section">
        <button disabled={!formIsValid} type="submit" class="mod-cta">Apply </button>
        <button type="button" on:click={_onClose}>Cancel</button>
    </section>
</form>
