import Ember from 'ember';
import TypeMixin from '../mixins/type';
import { set, get } from '@ember/object';
import { isArray } from '@ember/array';
import { displayKeyFor, validateLength, validateChars, validateHostname, validateDnsLabel } from '../utils/validate';
import { normalizeType } from '../utils/normalize';

const STRING_LIKE_TYPES = [
  'string',
  'date',
  'blob',
  'enum',
  'multiline',
  'masked',
  'password',
  'dnslLabel',
  'hostname',
];

var Actionable = Ember.Object.extend(Ember.ActionHandler);
var Resource = Actionable.extend(TypeMixin, {
  // You should probably override intl with a real translator...
  intl: {
    t(key) {
      return key;
    },
  },

  toString() {
    let str = 'resource:'+this.get('type');
    const id = this.get('id');

    if ( id ) {
      str += ':' + id;
    }

    return str;
  },

  serialize() {
    var data = this._super.apply(this,arguments);
    if ( this.constructor.mangleOut ) {
      return this.constructor.mangleOut(data);
    }

    return data;
  },

  schema: function() {
    const schema = this.get('store').getById('schema', this.get('type'));
    return schema;
  }.property('type'),

  validationErrors() {
    const intl = this.get('intl');

    const errors = [];
    const originalType = this.get('type');
    if ( !originalType ) {
      console.warn('No type found to validate', this);
      return [];
    }

    const type = normalizeType(originalType);
    const schema = this.get('store').getById('schema', type);

    if ( !schema ) {
      console.warn('No schema found to validate', type, this);
      return [];
    }

    // Trim all the values to start so that empty strings become nulls
    this.trimValues();

    const fields = schema.resourceFields||{};
    const keys = Object.keys(fields);
    let field, key, val, displayKey;
    for ( let i = 0 ; i < keys.length ; i++ ) {
      key = keys[i];
      field = fields[key];
      val = get(this, key);
      displayKey = displayKeyFor(type, key, intl);

      if ( val === undefined ) {
        val = null;
      }

      if ( field.type.indexOf('[') >= 0 ) {
        // array, map, reference
        // @TODO something...
      } else if ( val && typeof val.validationErrors === 'function' ) {
        // embedded schema type
        errors.pushObjects(val.validationErrors());
      } else if ( field.type === 'float' && typeof val === 'string' ) {
        // Coerce strings to floats
        val = parseFloat(val) || null; // NaN becomes null
        set(this, key, val);
      } else if ( field.type === 'int' && typeof val === 'string' ) {
        // Coerce strings to ints
        val = parseInt(val, 10) || null;
        set(this, key, val);
      }

      // Empty strings on nullable string fields -> null
      if ( field.nullable &&
          typeof val === 'string' &&
          val.length === 0 &&
          STRING_LIKE_TYPES.includes(field.type)
      ) {
        val = null;
        set(this, key, val);
      }

      let len = 0;
      if ( val ) {
        len = get(val, 'length');
      }

      if (
        field.required &&
        (
          val === null ||
          (typeof val === 'string' && len === 0) ||
          (isArray(val) && len === 0)
        )
      ) {
        errors.push(intl.t('validation.required', {key: displayKey}));
        continue;
      }

      validateLength(val, field, displayKey, intl, errors);
      validateChars( val, field, displayKey, intl, errors);

      if ( field.type === 'dnsLabel' || field.type === 'hostname' ) {
        // DNS types should be lowercase
        const tolower = (val||'').toLowerCase();
        if ( tolower !== val ) {
          val = tolower;
          set(this, key, val);
        }

        if ( field.type === 'dnsLabel' ) {
          validateDnsLabel(val, displayKey, intl, errors);
        } else if ( field.type === 'hostname') {
          validateHostname(val, displayKey, intl, errors);
        }
      }
    }

    return errors;
  },
});

// trimValues uses the definition of Resource so it needs to be a separate step
Resource.reopen({
  trimValues(depth, seenObjs) {
    if ( !depth ) {
      depth = 0;
    }

    if ( !seenObjs ) {
      seenObjs = [];
    }

    this.eachKeys((val,key) => {
      set(this, key, recurse(val,depth));
    }, false);

    return this;

    function recurse(val, depth) {
      if ( depth > 10 ) {
        return val;
      } else if ( typeof val === 'string' ) {
        return val.trim();
      } else if ( isArray(val) ) {
        val.beginPropertyChanges();
        val.forEach((v, idx) => {
          var out = recurse(v, depth+1);
          if ( val.objectAt(idx) !== out ) {
            val.replace(idx, 1, out);
          }
        });
        val.endPropertyChanges();
        return val;
      } else if ( Resource.detectInstance(val) ) {
        // Don't include a resource we've already seen in the chain
        if ( seenObjs.indexOf(val) > 0 ) {
          return null;
        }

        seenObjs.pushObject(val);
        return val.trimValues(depth+1, seenObjs);
      } else if ( val && typeof val === 'object' ) {
        Object.keys(val).forEach(function(key) {
          // Skip keys with dots in them, like container labels
          if ( key.indexOf('.') === -1 ) {
            set(val, key, recurse(val[key], depth+1));
          }
        });
        return val;
      } else {
        return val;
      }
    }
  },
});

Resource.reopenClass({
  // Request a default sort if none is specified
  defaultSortBy: '',

  // You can provide a function here to mangle data before it is passed to store.createRecord() for purposes of evil.
  mangleIn: null,

  // You can provide a function here to mangle data after it is serialized for purposes of even more evil.
  mangleOut: null,
});

export default Resource;
