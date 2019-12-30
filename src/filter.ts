export class FilterData {
  public static operations = {
    eq(value, id) {
      if (value instanceof Date) {
        return `value ? (value.valueOf == ${value.valueOf()}) : false`;
      } else {
        return `value ? (value${id ? '.toString()' : ''} == ${JSON.stringify(
          value,
        )}) : false`;
      }
    },
    size(value) {
      if (value) {
        return `value ? (value.length === ${value}) : false`;
      }
    },
    gt(value, id) {
      if (value instanceof Date) {
        return `value ? (value.valueOf > ${value.valueOf()}) : false`;
      } else {
        return `value ?( value${id ? '.toString()' : ''} > ${JSON.stringify(
          value,
        )}) : false`;
      }
    },
    gte(value, id) {
      if (value instanceof Date) {
        return `value ? (value.valueOf >= ${value.valueOf()}) : false`;
      } else {
        return `value ? (value${id ? '.toString()' : ''} >= ${JSON.stringify(
          value,
        )}) : false`;
      }
    },
    lt(value, id) {
      if (value instanceof Date) {
        return `value ? (value.valueOf < ${value.valueOf()}) : false`;
      } else {
        return `value ? (value${id ? '.toString()' : ''} < ${JSON.stringify(
          value,
        )}) : false`;
      }
    },
    lte(value, id) {
      if (value instanceof Date) {
        return `value ? (value.valueOf <= ${value.valueOf()}) : false`;
      } else {
        return `value ? (value${id ? '.toString()' : ''} <= ${JSON.stringify(
          value,
        )}) : false`;
      }
    },
    ne(value, id) {
      if (value instanceof Date) {
        return `value ? (value.valueOf !== ${value.valueOf()}) : false`;
      } else {
        return `value ? (value${id ? '.toString()' : ''} !== ${JSON.stringify(
          value,
        )}) : false`;
      }
    },
    in(value, id) {
      if (value[0] instanceof Date) {
        return `value ? (${JSON.stringify(
          value.map(v => v.valueOf()),
        )}.indexOf(value) !== -1) : false`;
      } else {
        return `value ? (${JSON.stringify(value)}.indexOf(value${
          id ? '.toString()' : ''
        }) !== -1) : false`;
      }
    },
    nin(value, id) {
      if (value[0] instanceof Date) {
        return `value ? (${JSON.stringify(
          value.map(v => v.valueOf()),
        )}.indexOf(value) === -1) : false`;
      } else {
        return `value ? (${JSON.stringify(
          id ? value.map(v => v.toString()) : value,
        )}.indexOf(value${id ? '.toString()' : ''}) === -1) : false`;
      }
    },
    contains(value) {
      if (value[0] instanceof Date) {
        return `value ? (value.indexOf(${JSON.stringify(
          value.valueOf(),
        )}) !== -1) : false`;
      } else {
        return `value ? (value.indexOf(${JSON.stringify(
          value,
        )}) !== -1) : false`;
      }
    },
    some(value) {
      if (value[0] instanceof Date) {
        return `value ? (value.some(i => (${JSON.stringify(
          value.map(v => v.valueOf()),
        )}.indexOf(i) !== -1))) : false`;
      } else {
        return `value.some(i => (${JSON.stringify(value)}.indexOf(i) !== -1))`;
      }
    },
    every(value) {
      if (value[0] instanceof Date) {
        return `value ? (value.every(i => (${JSON.stringify(
          value.map(v => v.valueOf()),
        )}.indexOf(i) !== -1))) : false`;
      } else {
        return `value ? (value.every(i => (${JSON.stringify(
          value,
        )}.indexOf(i) !== -1))) : false`;
      }
    },
    except(value) {
      if (value[0] instanceof Date) {
        return `vale ? (value.indexOf(${JSON.stringify(
          value.valueOf(),
        )}) === -1) : false`;
      } else {
        return `value ? (value.indexOf(${JSON.stringify(
          value,
        )}) === -1) : false`;
      }
    },
    none(value) {
      if (value[0] instanceof Date) {
        return `value ? (value.every(i => (${JSON.stringify(
          value.map(v => v.valueOf()),
        )}.indexOf(i) === -1))) : false`;
      } else {
        return `value ? (value.every(i => (${JSON.stringify(
          value,
        )}.indexOf(i) === -1))) : false`;
      }
    },
    or(value) {
      return (
        '( value ? (' +
        value.map(v => `(${FilterData.go(v)})`).join('||') +
        ') : false )'
      );
    },
    and(value) {
      return (
        '( value ? (' +
        value.map(v => `(${FilterData.go(v)})`).join('&&') +
        ') : false )'
      );
    },
    nor(value) {
      return (
        '( value ? !(' +
        value.map(v => `(${FilterData.go(v)})`).join('||') +
        ') : false )'
      );
    },
    not(value) {
      return (
        '( value ? !(' +
        value.map(v => `(${FilterData.go(v)})`).join('&&') +
        ') : false )'
      );
    },
    exists(value) {
      return `value ? (${
        value ? '' : '!'
      }(value !== undefined && value !== null && value !== '')) : false`;
    },
    match(value) {
      return `(value ? (new RegExp("${value}")).test(value.toString()) : false)`;
    },
    imatch(value) {
      return `(value ? (new RegExp("${value}","i")).test(value.toString()) : false)`;
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
      keys.forEach(key => {
        if (FilterData.operations.hasOwnProperty(key)) {
          result.push(FilterData.operations[key](node[key], id));
        } else {
          let idKey = fieldMap.hasOwnProperty(key);
          if (key !== '*') {
            result.push(
              `((value)=>${FilterData.go(node[key], fieldMap, idKey) ||
                true})(value ? value.${idKey ? fieldMap[key] : key} : false )`,
            );
          } else {
            result.push(
              ` value ? (Object.keys(value).some(key =>(value=>${FilterData.go(
                node[key],
                fieldMap,
                idKey,
              ) || true} : false)(value ? value[key] : false)))`,
            );
          }
        }
      });
      return result.length > 0 ? result : undefined;
    } else {
      return FilterData.operations.eq(node, id);
    }
  }
}
