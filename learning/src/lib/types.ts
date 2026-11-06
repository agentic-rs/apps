import type { LlmMessage, LlmProvenance, LlmSelection } from '@apell/sdk';

export interface LearningMemory {
  summary: string;
  learned: boolean;
  updated_at: string;
  source_turn_id: string;
}

export interface LearningTurn {
  id: string;
  created_at: string;
  user_text: string;
  assistant_text: string;
  user_message: LlmMessage;
  assistant_message: LlmMessage;
  provenance: LlmProvenance;
}

export interface KeyPoint {
  id: string;
  title: string;
  description: string;
  turns: LearningTurn[];
  memory: LearningMemory | null;
}

export interface Topic {
  schema_version: 1;
  id: string;
  title: string;
  goal: string;
  model: LlmSelection | null;
  key_points: KeyPoint[];
  created_at: string;
  updated_at: string;
}

export interface TopicStore {
  list(): Promise<Topic[]>;
  save(topic: Topic): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface GenerationOptions {
  signal: AbortSignal;
  on_text?: (text: string) => void;
}

export interface LearningGuide {
  available: boolean;
  chooseModel(current?: LlmSelection): Promise<LlmSelection | null>;
  plan(topic: Topic, options: GenerationOptions): Promise<KeyPoint[]>;
  explore(
    topic: Topic,
    point: KeyPoint,
    question: string,
    options: GenerationOptions,
  ): Promise<LearningTurn>;
  summarize(
    topic: Topic,
    point: KeyPoint,
    options: GenerationOptions,
  ): Promise<LearningMemory>;
}

export interface LearningPlatform {
  store: TopicStore;
  guide: LearningGuide;
  native: boolean;
}
