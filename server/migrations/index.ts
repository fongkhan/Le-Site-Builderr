import * as migration_20261020_134257_initial from './20261020_134257_initial';

export const migrations = [
  {
    up: migration_20261020_134257_initial.up,
    down: migration_20261020_134257_initial.down,
    name: '20261020_134257_initial'
  },
];
