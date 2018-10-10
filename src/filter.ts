export class FilterData {
  public static operations = {
    eq(value, fieldMap, id) {
      if (value instanceof Date) {
        return `value.valueOf == ${value.valueOf()}`;
      } else {
        return `value${id ? '.toString()' : ''} == ${JSON.stringify(value)}`;
      }
    },
    size(value, fieldMap, id) {
      if (value) {
        return `value.length === ${value}`;
      }
    },
    gt(value, fieldMap, id) {
      if (value instanceof Date) {
        return `value.valueOf > ${value.valueOf()}`;
      } else {
        return `value${id ? '.toString()' : ''} > ${JSON.stringify(value)}`;
      }
    },
    gte(value, fieldMap, id) {
      if (value instanceof Date) {
        return `value.valueOf >= ${value.valueOf()}`;
      } else {
        return `value${id ? '.toString()' : ''} >= ${JSON.stringify(value)}`;
      }
    },
    lt(value, fieldMap, id) {
      if (value instanceof Date) {
        return `value.valueOf < ${value.valueOf()}`;
      } else {
        return `value${id ? '.toString()' : ''} < ${JSON.stringify(value)}`;
      }
    },
    lte(value, fieldMap, id) {
      if (value instanceof Date) {
        return `value.valueOf <= ${value.valueOf()}`;
      } else {
        return `value${id ? '.toString()' : ''} <= ${JSON.stringify(value)}`;
      }
    },
    ne(value, fieldMap, id) {
      if (value instanceof Date) {
        return `value.valueOf !== ${value.valueOf()}`;
      } else {
        return `value${id ? '.toString()' : ''} !== ${JSON.stringify(value)}`;
      }
    },
    in(value, fieldMap, id) {
      if (value[0] instanceof Date) {
        return `${JSON.stringify(
          value.map(v => v.valueOf()),
        )}.indexOf(value) !== -1`;
      } else {
        return `${JSON.stringify(value)}.indexOf(value${
          id ? '.toString()' : ''
        }) !== -1`;
      }
    },
    nin(value, fieldMap, id) {
      if (value[0] instanceof Date) {
        return `${JSON.stringify(
          value.map(v => v.valueOf()),
        )}.indexOf(value) === -1`;
      } else {
        return `${JSON.stringify(
          id ? value.map(v => v.toString()) : value,
        )}.indexOf(value${id ? '.toString()' : ''}) === -1`;
      }
    },
    contains(value, fieldMap, id) {
      if (value[0] instanceof Date) {
        return `value.indexOf(${JSON.stringify(value.valueOf())}) !== -1`;
      } else {
        return `value.indexOf(${JSON.stringify(value)}) !== -1`;
      }
    },
    some(value, fieldMap, id) {
      if (value[0] instanceof Date) {
        return `value.some(i => (${JSON.stringify(
          value.map(v => v.valueOf()),
        )}.indexOf(i) !== -1))`;
      } else {
        return `value.some(i => (${JSON.stringify(value)}.indexOf(i) !== -1))`;
      }
    },
    every(value, fieldMap, id) {
      if (value[0] instanceof Date) {
        return `value.every(i => (${JSON.stringify(
          value.map(v => v.valueOf()),
        )}.indexOf(i) !== -1))`;
      } else {
        return `value.every(i => (${JSON.stringify(value)}.indexOf(i) !== -1))`;
      }
    },
    except(value, fieldMap, id) {
      if (value[0] instanceof Date) {
        return `value.indexOf(${JSON.stringify(value.valueOf())}) === -1`;
      } else {
        return `value.indexOf(${JSON.stringify(value)}) === -1`;
      }
    },
    none(value, fieldMap, id) {
      if (value[0] instanceof Date) {
        return `value.every(i => (${JSON.stringify(
          value.map(v => v.valueOf()),
        )}.indexOf(i) === -1))`;
      } else {
        return `value.every(i => (${JSON.stringify(value)}.indexOf(i) === -1))`;
      }
    },
    or(value, fieldMap, id) {
      return '(' + value.map(v => `(${FilterData.go(v)})`).join('||') + ')';
    },
    and(value, fieldMap, id) {
      return '(' + value.map(v => `(${FilterData.go(v)})`).join('&&') + ')';
    },
    nor(value, fieldMap, id) {
      return '!(' + value.map(v => `(${FilterData.go(v)})`).join('||') + ')';
    },
    not(value, fieldMap, id) {
      return '!(' + value.map(v => `(${FilterData.go(v)})`).join('&&') + ')';
    },
    exists(value, fieldMap, id) {
      return `${
        value ? '' : '!'
      }(value !== undefined && value !== null && value !== '')`;
    },
    match(value, fieldMap, id) {
      return `(new RegExp("${value}")).test(value.toString())`;
    },
    imatch(value, fieldMap, id) {
      return `(new RegExp("${value}","i")).test(value.toString())`;
    },
  };

  public static create(obj, fieldMap: { [key: string]: any } = { id: 'id' }) {
    let filter = FilterData.go(obj, fieldMap);
    // tslint:disable-next-line:no-eval
    return eval(
      `(value)=>${
        filter && Array.isArray(filter) ? filter.join('&&') : 'true'
      }`,
    );
  }

  public static go(
    node: object[] | object,
    fieldMap: { [key: string]: any } = { id: 'id' },
    id: boolean = false,
    result?,
  ) {
    if (Array.isArray(node)) {
      return node
        .map(n => FilterData.go(n, fieldMap, id, result))
        .filter(n => n);
    } else if (
      typeof node === 'object' &&
      (node.constructor === Object || node.constructor === undefined)
    ) {
      if (!result) {
        result = [];
      }
      let keys = Object.keys(node);
      keys.forEach((key, index) => {
        if (FilterData.operations.hasOwnProperty(key)) {
          result.push(FilterData.operations[key](node[key], fieldMap, id));
        } else {
          let idKey = fieldMap.hasOwnProperty(key);
          if (key !== '*') {
            result.push(
              `((value)=>${FilterData.go(node[key], fieldMap, idKey) ||
                true})(value.${idKey ? fieldMap[key] : key})`,
            );
          } else {
            result.push(
              `(Object.keys(value).some(key =>(value=>${FilterData.go(
                node[key],
                fieldMap,
                idKey,
              ) || true})(value[key])))`,
            );
          }
        }
      });
      return result.length > 0 ? result : undefined;
    } else {
      return FilterData.operations.eq(node, fieldMap, id);
    }
  }
}
