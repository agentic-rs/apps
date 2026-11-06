import { useEffect, useRef, useState } from 'react';
import { createTopic, needsMemoryUpdate } from './model';
import { createPlatform } from './platform';
import type {
  KeyPoint,
  LearningMemory,
  LearningPlatform,
  Topic,
} from './types';

export interface ConfirmationRequest {
  title: string;
  message: string;
  confirm_label: string;
  danger?: boolean;
}

function sorted(topics: Topic[]): Topic[] {
  return [...topics].sort(
    (a, b) =>
      b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id),
  );
}

function replaceTopic(topics: Topic[], topic: Topic): Topic[] {
  return sorted([...topics.filter((item) => item.id !== topic.id), topic]);
}

function initialPoint(topic: Topic | undefined): string | null {
  return (
    topic?.key_points.find((point) => !point.memory?.learned)?.id ??
    topic?.key_points[0]?.id ??
    null
  );
}

function withPoint(topic: Topic, point: KeyPoint): Topic {
  return {
    ...topic,
    updated_at: new Date().toISOString(),
    key_points: topic.key_points.map((item) =>
      item.id === point.id ? point : item,
    ),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

export function useLearning() {
  const [platform, setPlatform] = useState<LearningPlatform | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [load_attempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState('');
  const [topic_id, setTopicId] = useState<string | null>(null);
  const [point_id, setPointId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [stream_text, setStreamText] = useState('');
  const [partial_text, setPartialText] = useState('');
  const [pending_save, setPendingSave] = useState<Topic | null>(null);
  const [memory_draft, setMemoryDraft] = useState<LearningMemory | null>(null);
  const [question, setQuestion] = useState('');
  const [new_title, setNewTitle] = useState('');
  const [new_goal, setNewGoal] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(
    null,
  );
  const confirmation_ref = useRef<((confirmed: boolean) => void) | null>(null);
  const active_job = useRef<AbortController | null>(null);
  const pending_ref = useRef<Topic | null>(null);
  const pending_memory_point_id = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError('');
    createPlatform()
      .then(async (next) => {
        const loaded = sorted(await next.store.list());
        if (disposed) return;
        setPlatform(next);
        setTopics(loaded);
        setTopicId(loaded[0]?.id ?? null);
        setPointId(initialPoint(loaded[0]));
        setLoading(false);
      })
      .catch((failure) => {
        if (!disposed) {
          setError(errorText(failure));
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
      active_job.current?.abort();
      confirmation_ref.current?.(false);
      confirmation_ref.current = null;
    };
  }, [load_attempt]);

  useEffect(() => {
    // Native applets cannot show browser unload prompts. This is an additional
    // browser-preview safeguard; in-app navigation uses the confirmation below.
    if (platform?.native) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (
        pending_save ||
        busy ||
        memory_draft !== null ||
        question.trim() ||
        new_title.trim() ||
        new_goal.trim()
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [
    platform,
    pending_save,
    busy,
    memory_draft,
    question,
    new_title,
    new_goal,
  ]);

  const visible_topics = pending_save
    ? replaceTopic(topics, pending_save)
    : topics;
  const topic = visible_topics.find((item) => item.id === topic_id) ?? null;
  const point =
    topic?.key_points.find((item) => item.id === point_id) ??
    topic?.key_points[0] ??
    null;
  const locked = Boolean(busy || pending_save || confirmation);

  function confirmAction(request: ConfirmationRequest): Promise<boolean> {
    if (confirmation_ref.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      confirmation_ref.current = resolve;
      setConfirmation(request);
    });
  }

  function resolveConfirmation(confirmed: boolean) {
    const resolve = confirmation_ref.current;
    confirmation_ref.current = null;
    setConfirmation(null);
    resolve?.(confirmed);
  }

  async function persist(
    next: Topic,
    resume_memory_point_id: string | null = null,
  ): Promise<boolean> {
    if (!platform) return false;
    try {
      await platform.store.save(next);
      setTopics((current) => replaceTopic(current, next));
      pending_ref.current = null;
      pending_memory_point_id.current = null;
      setPendingSave(null);
      return true;
    } catch (failure) {
      // Keep the complete result even if validation or disk storage fails.
      // Retrying never regenerates it; explicit discard can restore durable data.
      pending_ref.current = next;
      pending_memory_point_id.current = resume_memory_point_id;
      setPendingSave(next);
      setError(
        `Your changes are still here, but could not be saved. ${errorText(failure)}`,
      );
      return false;
    }
  }

  async function refreshMemory(
    current: Topic,
    current_point: KeyPoint,
    controller: AbortController,
  ) {
    if (!platform || !needsMemoryUpdate(current_point)) return;
    setBusy('Remembering what you learned');
    setStreamText('');
    try {
      const memory = await platform.guide.summarize(current, current_point, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        setError(
          'Your conversation is saved. Memory update stopped; choose Update memory to try again.',
        );
        return;
      }
      await persist(withPoint(current, { ...current_point, memory }));
    } catch (failure) {
      // The exchange is already durable. Memory failures must never repeat it
      // or replace the last successful memory with an incomplete assessment.
      setError(
        controller.signal.aborted
          ? 'Your conversation is saved. Memory update stopped; choose Update memory to try again.'
          : `Your conversation is saved, but memory could not be updated. ${errorText(failure)} Choose Update memory to retry.`,
      );
    }
  }

  async function run(
    label: string,
    operation: (controller: AbortController) => Promise<void>,
    retry = false,
  ) {
    if (
      active_job.current ||
      confirmation_ref.current ||
      (pending_ref.current && !retry)
    )
      return;
    const controller = new AbortController();
    active_job.current = controller;
    setBusy(label);
    setError('');
    setStreamText('');
    setPartialText('');
    try {
      await operation(controller);
    } catch (failure) {
      setError(
        controller.signal.aborted
          ? 'Stopped. Your saved work is unchanged.'
          : errorText(failure),
      );
      if (
        typeof failure === 'object' &&
        failure &&
        'partial_content' in failure &&
        typeof failure.partial_content === 'string'
      ) {
        setPartialText(failure.partial_content);
      }
    } finally {
      if (active_job.current === controller) {
        active_job.current = null;
        setBusy('');
        setStreamText('');
      }
    }
  }

  async function canNavigate(): Promise<boolean> {
    if (active_job.current || pending_ref.current || confirmation_ref.current)
      return false;
    const has_draft =
      memory_draft !== null ||
      question.trim() ||
      new_title.trim() ||
      new_goal.trim();
    if (
      has_draft &&
      !(await confirmAction({
        title: 'Discard your draft?',
        message:
          'Your unsaved writing will be discarded when you leave. Saved conversations and memories will stay.',
        confirm_label: 'Discard draft',
        danger: true,
      }))
    )
      return false;
    setMemoryDraft(null);
    setQuestion('');
    setNewTitle('');
    setNewGoal('');
    setError('');
    setPartialText('');
    return true;
  }

  return {
    topics: visible_topics,
    topic,
    point,
    platform,
    loading,
    error,
    busy,
    locked,
    stream_text,
    partial_text,
    pending_save,
    memory_draft,
    question,
    new_title,
    new_goal,
    confirmation,
    resolveConfirmation,
    setQuestion,
    setMemoryDraft,
    setNewTitle,
    setNewGoal,
    reload: () => setLoadAttempt((value) => value + 1),
    clearError: () => {
      setError('');
      setPartialText('');
    },
    cancel: () => active_job.current?.abort(),
    leaveView: canNavigate,
    editMemory: async (id: string) => {
      const target = topic?.key_points.find((item) => item.id === id);
      if (!target?.memory || active_job.current || pending_ref.current)
        return false;
      if (id !== point?.id && !(await canNavigate())) return false;
      setPointId(id);
      setMemoryDraft(target.memory);
      return true;
    },
    selectTopic: async (id: string | null) => {
      if (id === topic_id) return true;
      if (!(await canNavigate())) return false;
      setTopicId(id);
      setPointId(initialPoint(visible_topics.find((item) => item.id === id)));
      return true;
    },
    selectPoint: async (id: string) => {
      if (id === point?.id) return true;
      if (!(await canNavigate())) return false;
      setPointId(id);
      return true;
    },
    create: async (title: string, goal: string) => {
      let created = false;
      await run('Saving topic', async () => {
        const next = createTopic(title, goal);
        await persist(next);
        setTopicId(next.id);
        setPointId(null);
        setNewTitle('');
        setNewGoal('');
        created = true;
      });
      return created;
    },
    chooseModel: () =>
      run('Choosing a model', async (controller) => {
        if (!platform || !topic || topic.key_points.length) return;
        const model = await platform.guide.chooseModel(
          topic.model ?? undefined,
        );
        if (model && !controller.signal.aborted)
          await persist({
            ...topic,
            model,
            updated_at: new Date().toISOString(),
          });
      }),
    generatePlan: () =>
      run('Mapping your topic', async (controller) => {
        if (!platform || !topic || topic.key_points.length) return;
        let current = topic;
        if (!current.model) {
          const model = await platform.guide.chooseModel();
          if (!model || controller.signal.aborted) return;
          current = { ...current, model, updated_at: new Date().toISOString() };
          if (!(await persist(current))) return;
        }
        const key_points = await platform.guide.plan(current, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        await persist({
          ...current,
          key_points,
          updated_at: new Date().toISOString(),
        });
        setPointId(key_points[0]?.id ?? null);
      }),
    ask: (text = question) =>
      run('Exploring this point', async (controller) => {
        if (!platform || !topic || !point || !text.trim()) return;
        setQuestion(text);
        const turn = await platform.guide.explore(topic, point, text.trim(), {
          signal: controller.signal,
          on_text: setStreamText,
        });
        if (controller.signal.aborted) return;
        const next_point = { ...point, turns: [...point.turns, turn] };
        const next = withPoint(topic, next_point);
        const saved = await persist(next, point.id);
        setQuestion('');
        if (saved) await refreshMemory(next, next_point, controller);
      }),
    summarize: () =>
      run('Remembering what you learned', async (controller) => {
        if (!platform || !topic || !point) return;
        await refreshMemory(topic, point, controller);
      }),
    saveMemory: () =>
      run('Saving your learning', async () => {
        if (!topic || !point || !memory_draft?.summary.trim()) return;
        await persist(
          withPoint(topic, {
            ...point,
            memory: {
              ...memory_draft,
              summary: memory_draft.summary.trim(),
              updated_at: new Date().toISOString(),
            },
          }),
        );
        setMemoryDraft(null);
      }),
    discardMemory: async () => {
      if (active_job.current || pending_ref.current || memory_draft === null)
        return;
      if (
        await confirmAction({
          title: 'Discard these memory edits?',
          message:
            'Your unsaved edits will be discarded. The saved learning memory will stay.',
          confirm_label: 'Discard draft',
          danger: true,
        })
      ) {
        setMemoryDraft(null);
      }
    },
    revisit: (id = point?.id) =>
      run('Updating progress', async () => {
        const target = topic?.key_points.find((item) => item.id === id);
        if (!topic || !target?.memory) return;
        await persist(
          withPoint(topic, {
            ...target,
            memory: {
              ...target.memory,
              learned: false,
              updated_at: new Date().toISOString(),
            },
          }),
        );
      }),
    retrySave: () =>
      run(
        'Retrying save',
        async (controller) => {
          const next = pending_ref.current;
          const resume_point_id = pending_memory_point_id.current;
          if (next && (await persist(next, resume_point_id))) {
            const current_point = next.key_points.find(
              (item) => item.id === resume_point_id,
            );
            if (current_point)
              await refreshMemory(next, current_point, controller);
          }
        },
        true,
      ),
    discardPending: async () => {
      if (active_job.current || !pending_ref.current) return;
      if (
        !(await confirmAction({
          title: 'Discard unsaved changes?',
          message:
            'The unsaved result will be discarded. Your last successfully saved conversations and memories will stay.',
          confirm_label: 'Discard changes',
          danger: true,
        }))
      )
        return;
      pending_ref.current = null;
      pending_memory_point_id.current = null;
      setPendingSave(null);
      setMemoryDraft(null);
      setError('');
      setPartialText('');
      const saved = topics.find((item) => item.id === topic_id);
      if (!saved) {
        setTopicId(null);
        setPointId(null);
      } else if (!saved.key_points.some((item) => item.id === point_id)) {
        setPointId(initialPoint(saved));
      }
    },
    removeTopic: () =>
      run('Removing topic', async () => {
        if (!platform || !topic) return;
        if (
          !(await confirmAction({
            title: 'Delete this topic?',
            message: `“${topic.title}” and all its conversations, memories, and unsaved drafts will be permanently deleted.`,
            confirm_label: 'Delete topic',
            danger: true,
          }))
        )
          return;
        await platform.store.remove(topic.id);
        setTopics((current) => current.filter((item) => item.id !== topic.id));
        setTopicId(null);
        setPointId(null);
        setMemoryDraft(null);
        setQuestion('');
      }),
  };
}
