/** The values of elections_turnout_class_check and results_turnout_class_check (D-329). */
export type TurnoutClass =
  | 'presidential_general'
  | 'midterm_general'
  | 'odd_year_general'
  | 'primary'
  | 'standalone_local'
  | 'odd_year_statewide'
  | 'spring_local'
  | 'spring_with_presidential_primary'
  | 'runoff';

/** The values of elections_kind_check (D-322). */
export type ElectionKind = 'primary' | 'general' | 'primary_runoff' | 'general_runoff' | 'special';
