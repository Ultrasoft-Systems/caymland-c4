'use strict';

const _ = require('lodash/fp');

const helpers = require('./helpers');

const createQueryBuilder = (uid, db) => {
  const meta = db.metadata.get(uid);
  const { tableName } = meta;

  // TODO: we could use a state to track the entire query instead of using knex directly

  let state = {
    type: 'select',
    select: [],
    count: null,
    first: false,
    data: null,
    where: [],
    joins: [],
    populate: null,
    limit: null,
    offset: null,
    orderBy: [],
    groupBy: [],
  };

  let counter = 0;
  const getAlias = () => `t${counter++}`;

  // TODO: actually rename columns to attributes then pick them
  // const pickAttributes = _.pick(Object.keys(meta.attributes));

  return {
    alias: getAlias(),
    getAlias,

    insert(data) {
      state.type = 'insert';
      state.data = data;

      return this;
    },

    delete() {
      state.type = 'delete';

      return this;
    },

    update(data) {
      state.type = 'update';
      state.data = data;

      return this;
    },

    count(count = '*') {
      state.type = 'count';
      state.count = count;

      return this;
    },

    // TODO: convert where into aliases where & nested joins
    where(where = {}) {
      const processedWhere = helpers.processWhere(where, { qb: this, uid, db });

      state.where.push(processedWhere);

      return this;
    },

    // TODO: handle aliasing logic
    select(args) {
      state.type = 'select';
      state.select = _.castArray(args).map(col => this.aliasColumn(col));

      return this;
    },

    addSelect(args) {
      state.select.push(..._.castArray(args).map(col => this.aliasColumn(col)));
      return this;
    },

    limit(limit) {
      state.limit = limit;
      return this;
    },

    offset(offset) {
      state.offset = offset;
      return this;
    },

    // TODO: map to column name
    orderBy(orderBy) {
      state.orderBy = helpers.processOrderBy(orderBy, { qb: this, uid, db });
      return this;
    },

    // TODO: add processing
    groupBy(groupBy) {
      state.groupBy = groupBy;
      return this;
    },

    // TODO: implement
    having() {},

    // TODO: add necessary joins to make populate easier / faster
    populate(populate) {
      state.populate = helpers.processPopulate(populate, { qb: this, uid, db });

      return this;
    },

    init(params = {}) {
      const { where, select, limit, offset, orderBy, groupBy, populate } = params;

      if (where) {
        this.where(where);
      }

      if (select) {
        this.select(select);
      } else {
        this.select('*');
      }

      if (limit) {
        this.limit(limit);
      }

      if (offset) {
        this.offset(offset);
      }

      if (orderBy) {
        this.orderBy(orderBy);
      }

      if (groupBy) {
        this.groupBy(groupBy);
      }

      if (populate) {
        this.populate(populate);
      }

      return this;
    },

    first() {
      state.first = true;
      return this;
    },

    join(join) {
      state.joins.push(join);
      return this;
    },

    aliasColumn(columnName) {
      if (columnName.indexOf('.') >= 0) return columnName;
      return this.alias + '.' + columnName;
    },

    // TODO: trigger result processing to allow 100% sql queries
    async execute() {
      const aliasedTableName = state.type === 'insert' ? tableName : { [this.alias]: tableName };

      try {
        const qb = db.connection(aliasedTableName);

        switch (state.type) {
          case 'select': {
            if (state.select.length === 0) {
              state.select = [this.aliasColumn('*')];
            }

            if (state.joins.length > 0) {
              // TODO: check implementation
              // add ordered columns to distinct in case of joins
              qb.distinct();
              state.select.unshift(...state.orderBy.map(({ column }) => column));
            }

            qb.select(state.select);
            break;
          }
          case 'count': {
            qb.count({ count: state.count });
            break;
          }
          case 'insert': {
            qb.insert(state.data);

            if (db.dialect.useReturning() && _.has('id', meta.attributes)) {
              qb.returning('id');
            }

            break;
          }
          case 'update': {
            qb.update(state.data);

            break;
          }
          case 'delete': {
            qb.del();

            break;
          }
        }

        if (state.limit) {
          qb.limit(state.limit);
        }

        if (state.offset) {
          qb.offset(state.offset);
        }

        if (state.orderBy.length > 0) {
          qb.orderBy(state.orderBy);
        }

        if (state.first) {
          qb.first();
        }

        if (state.groupBy.length > 0) {
          qb.groupBy(state.groupBy);
        }

        if (state.where) {
          helpers.applyWhere(qb, state.where);
        }

        // TODO: apply joins
        if (state.joins.length > 0) {
          helpers.applyJoins(qb, state.joins);
        }

        // TODO: hanlde populate

        console.log('Running query: ', qb.toSQL());

        const queryResult = await qb;

        const results = db.dialect.processResult(queryResult, state.type);

        // if query response should be process (in case of custom queries we shouldn't for example)

        if (state.populate) {
          await helpers.applyPopulate(_.castArray(results), state.populate, { qb: this, uid, db });
        }

        return results;

        // TODO:
        // if (!processResult) {
        //   return results;
        // } else {
        //   return Array.isArray(results)
        //     ? results.map((r) => pickAttributes(r))
        //     : pickAttributes(results);
        // }
        /*
        - format results
        - populate relationships
      */

        // return results;
      } catch (error) {
        db.dialect.transformErrors(error);
      }
    },
  };
};

module.exports = createQueryBuilder;