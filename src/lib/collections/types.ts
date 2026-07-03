export type FieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'image'
  | 'gallery'
  | 'url'
  | 'email'
  | 'json';

export interface FieldDef {
  key: string; // snake_case, unique within collection
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[]; // select / multiselect
  help?: string;
}
