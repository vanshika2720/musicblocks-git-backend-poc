// handles the tutorial progression state for a student
// in real Music Blocks this touches localStorage in the browser,
// here we just keep it in a plain JS object per session so we can demo the logic

type TutorialState = {
    seen: string[];
    streakCount: number;
    lastSavedAt: number | null;
};

const studentStates: Map<string, TutorialState> = new Map();

function getState(studentId: string): TutorialState {
    if (!studentStates.has(studentId)) {
        studentStates.set(studentId, {
            seen: [],
            streakCount: 0,
            lastSavedAt: null,
        });
    }
    return studentStates.get(studentId)!;
}

export function shouldShowTutorial(studentId: string, moment: string): boolean {
    const state = getState(studentId);
    return !state.seen.includes(moment);
}

export function markTutorialSeen(studentId: string, moment: string): void {
    const state = getState(studentId);
    if (!state.seen.includes(moment)) {
        state.seen.push(moment);
    }
}

// called every time a student saves - tracks their commit streak
export function recordSave(studentId: string): { streak: number; tutorialMoment: string | null } {
    const state = getState(studentId);
    const now = Date.now();

    // if they saved within the last 24h, it counts as the same streak
    const oneDay = 1000 * 60 * 60 * 24;
    if (state.lastSavedAt && now - state.lastSavedAt < oneDay) {
        state.streakCount += 1;
    } else {
        state.streakCount = 1;
    }
    state.lastSavedAt = now;

    const tutorialMoment = shouldShowTutorial(studentId, "first_save") ? "first_save" : null;
    if (tutorialMoment) {
        markTutorialSeen(studentId, tutorialMoment);
    }

    return { streak: state.streakCount, tutorialMoment };
}

export function getTutorialProgress(studentId: string) {
    const state = getState(studentId);
    const allMoments = [
        "first_save",
        "first_commit_message",
        "first_history_view",
        "first_fork",
        "first_pr",
    ];
    return {
        seen: state.seen,
        remaining: allMoments.filter((m) => !state.seen.includes(m)),
        streak: state.streakCount,
    };
}

export function resetStudentState(studentId: string): void {
    studentStates.delete(studentId);
}
