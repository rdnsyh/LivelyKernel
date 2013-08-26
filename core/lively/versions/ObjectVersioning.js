module('lively.versions.ObjectVersioning').requires('lively.versions.UglifyTransformer').toRun(function() {
    
Object.extend(lively.versions.ObjectVersioning, {
    versioningProxyHandler: function(objectID) {
        return {
            // these proxies are fully virtual, so the first parameter to all 
            // traps is an empty object and shouldn't be touched
            
            // __objectID can be resolved via global object table
            __objectID: objectID,
            
            // === helpers ===
            targetObject: function() {
                return this.getObjectByID(this.__objectID);
            },
            getObjectByID: function(id) {
                return lively.versions.ObjectVersioning.getObjectByID(id);
            },
            proxyNonPrimitiveObjects: function(obj) {
                var result = obj;
                
                if (!lively.versions.ObjectVersioning.isProxy(obj)) {
                    if (!lively.versions.ObjectVersioning.isPrimitiveObject(obj)) {
                        result = lively.versions.ObjectVersioning.proxyFor(obj);
                    }
                }
                
                return result;
            },
            
            // === proxy handler traps ===
            set: function(virtualTarget, name, value, receiver) {
                var targetObject,
                    newObject;
                
                targetObject = this.targetObject();
                
                if (name === '__proto__') {
                    if (value && value.__objectID) {
                        targetObject.__protoID = value.__objectID;
                    } else {
                        targetObject.__protoID = null;
                        targetObject.__proto__ = value;
                    }
                }
                
                // copy-on-first-write objects commited in previous versions
                if (Object.isFrozen(targetObject)) {
                    newObject = Object.clone(targetObject);
                    lively.versions.ObjectVersioning.setObjectForProxy(newObject, receiver);
                    targetObject = newObject;
                }
                       
                targetObject[name] = value;
                
                return true;
            },
            get: function(virtualTarget, name, receiver) {
                var targetObject, result, nextAncestor;
                
                // proxy meta-information
                if (name === '__isProxy') {
                    return true;
                }
                if (name === '__objectID') {
                    return this.__objectID;
                }
                
                targetObject = this.targetObject();
                if (name === '__proto__') {
                    if (targetObject.__protoID) {
                        return lively.ProxyTable[targetObject.__protoID];
                    } else {
                        return targetObject.__proto__;
                    }
                }
                
                // TODO: retrieving the prototype of a constructor needs to go
                // through the global object table as well, which then needs to
                // be reflected in the the construct-trap
                if (name === 'prototype' && Object.isFunction(targetObject)) {
                    return targetObject.prototype;
                }
                
                result = targetObject[name];
                
                if (result === undefined) {
                    nextAncestor = this.getObjectByID(targetObject.__protoID);
                    while (result === undefined && nextAncestor) {
                        result = nextAncestor[name];
                        nextAncestor = nextAncestor.__protoID ? 
                            this.getObjectByID(nextAncestor.__protoID) : 
                            null;
                    }
                }
                
                return this.proxyNonPrimitiveObjects(result); 
            },
            apply: function(virtualTarget, thisArg, args) {
                var result,
                    OV = lively.versions.ObjectVersioning,
                    method = this.targetObject(),
                    targetObject = thisArg;
                
                result = method.apply(targetObject, args);
                
                return this.proxyNonPrimitiveObjects(result);
            },
            construct: function(virtualTarget, args) {
                var OriginalConstructor = this.targetObject(),
                    newInstance;
                    
                // the following workaround is necessary as it's not possible to supply
                // a variable number of arguments to a constructor. using eval to create
                // a constructor with a useful name for debugging
                eval('var wrapper = function ' + OriginalConstructor.name + '() {\n' +
                '    return OriginalConstructor.apply(this, args);\n' + 
                '}');
                wrapper.prototype = OriginalConstructor.prototype;
                newInstance = new wrapper();
                
                return lively.versions.ObjectVersioning.proxyFor(newInstance);
            },
            getPrototypeOf: function(virtualTarget) {
                var protoID = this.targetObject().__protoID;
                if (protoID) {
                    return lively.ProxyTable[protoID];
                } else {
                    return Object.getPrototypeOf(this.targetObject());
                }
            },
            has: function(virtualTarget, name) {
                var result, targetObject, protoID, nextAncestor;
                
                // FIXME: does this happen at all?
                // proxy meta-information
                if (name === '__objectID') {
                    return true;
                }
                
                targetObject = this.targetObject();
                
                result = (name in targetObject);
                
                // FIXME: pretty similar in how proto-lookup is done in the get-trap
                if (!result) {
                    protoID = targetObject.__protoID
                    nextAncestor = protoID ? this.getObjectByID(protoID) : null;
                    while (!result && nextAncestor) {
                        result = (name in nextAncestor);
                        nextAncestor = nextAncestor.__protoID ? 
                            this.getObjectByID(nextAncestor.__protoID) : 
                            null;
                    }
                }
                
                return result;
            },
            hasOwn: function(virtualTarget, name) {
                // proxy meta-information
                if (name === '__objectID') {
                    return true;
                }
                
                return ({}).hasOwnProperty.call(this.targetObject(), name);
            },
            getOwnPropertyNames: function(virtualTarget) {
                return Object.getOwnPropertyNames(this.targetObject());
            },
            enumerate: function(virtualTarget) {
                var targetObject = this.targetObject(),
                    enumerableProps = [],
                    nextAncestor,
                    protoID;
                    
                for (var prop in targetObject) {
                    enumerableProps.push(prop);
                }
                
                protoID = targetObject.__protoID;
                nextAncestor = protoID ? this.getObjectByID(protoID) : null;
                while (nextAncestor) {
                    for (var prop in nextAncestor) {
                        enumerableProps.push(prop);
                    }
                    nextAncestor = nextAncestor.__protoID ? 
                        this.getObjectByID(nextAncestor.__protoID) : 
                        null;
                }
                
                enumerableProps = enumerableProps.filter(function(ea) {
                    return !(['__objectID', '__protoID'].include(ea));
                });
                return enumerableProps;
            },
            keys: function(virtualTarget) {
                var keys = Object.keys(this.targetObject());
                keys = keys.filter(function(ea) {
                    return !(['__objectID', '__protoID'].include(ea));
                });
                return keys;
            },
            freeze: function(virtualTarget) {
                // freeze the virtual target as well, as required by the spec
                Object.freeze(virtualTarget);
                
                return Object.freeze(this.targetObject());
            },
            isFrozen: function(virtualTarget) {
                return Object.isFrozen(this.targetObject());
            },
            seal: function(virtualTarget) {
                // seal the virtual target as well, as required by the spec
                Object.seal(virtualTarget);
                
                return Object.seal(this.targetObject());
            },
            isSealed: function(virtualTarget) {
                return Object.isSealed(this.targetObject());
            },
            preventExtensions: function(virtualTarget) {
                // prevent extensions to the virtual target as well, as
                // required by the spec
                Object.preventExtensions(virtualTarget);
                
                return Object.preventExtensions(this.targetObject());
            },
            isExtensible: function(virtualTarget) {
                return Object.isExtensible(this.targetObject());
            },
        };
    }
});

Object.extend(lively.versions.ObjectVersioning, {
    init: function() {
        lively.CurrentObjectTable = [];
        lively.ProxyTable = [];
        
        lively.Versions = []; // a linear history (for now)
        lively.Versions.push(lively.CurrentObjectTable);
        
        this.wrapObjectCreate();
    },
    wrapObjectCreate: function() {
        lively.origObjectCreate = Object.create
        
        var wrappedCreate = function(proto) {
            // when proxied are used as prototypes, the prototypes can't be changed.
            // seems related to: http://github.com/tvcutsem/harmony-reflect/issues/18
            if (lively.isProxy(proto)) {
                return lively.origObjectCreate({
                    __realPrototypeObjectID: proto.__objectID
                });
            } else {
                return lively.origObjectCreate.apply(null, arguments);
            }
        }
        // Object.create = wrappedCreate;
        lively.create = wrappedCreate;
    },
    proxyFor: function(target) {        
        // proxies are fully virtual objects: they don't point to their target, 
        // but refer to it by their __objectID through lively.CurrentObjectTable
        var proto, protoID, virtualTarget, proxy;
        
        if (this.isProxy(target)) 
            throw new TypeError('Proxies shouldn\'t be inserted into the object tables');
            
        if (target !== Object(target)) 
            throw new TypeError('Primitive objects shouldn\'t be wrapped');
            
        if (target.__objectID)
            return lively.ProxyTable[target.__objectID];
            
        // TODO: what about the prototype property of functions?
                
        proto = Object.getPrototypeOf(target);
        if (proto && !([Object.prototype, Function.prototype, Array.prototype].include(proto))) {
            if (this.isProxy(proto)) {
                // this shouldn't happen, see wrapObjectCreate
                protoID = proto.__objectID;
            } else if (proto.__realPrototypeObjectID) {
                protoID = proto.__realPrototypeObjectID;
            } else {
                protoID = this.proxyFor(proto).__objectID;
            }
            target.__proto__ = Object.prototype;
        } else {
            // proto is a root prototype
            protoID = null;
        }
        
        // TODO: make __objectID not non-writable, non-configurable, and not enumerable 
        // using a property descriptor. then remove the filtering from the enumerate- and
        // the has-trap
        target.__objectID = lively.CurrentObjectTable.length;
        target.__protoID = protoID;
        lively.CurrentObjectTable.push(target);
        
        virtualTarget = this.virtualTargetFor(target);
        proxy = Proxy(virtualTarget, this.versioningProxyHandler(target.__objectID));
        lively.ProxyTable[target.__objectID] = proxy;
        
        return proxy;
    },
    virtualTargetFor: function(actualTarget) {
        var virtualTarget;
        // only proxies for functions do trap function application
        if (Object.isFunction(actualTarget)) {
            // function names are non-configurable, non-writable properties, and the proxy spec
            // requires such the values to be returned consistently from the get-trap, that is,
            // matching the actual proxy target
            virtualTarget = eval('virtualTarget = function ' + actualTarget.name + '() {}');
        } else {
            virtualTarget = {};
        }
        return virtualTarget;
    },
    proxyForRootPrototype: function() {
        if (!lively.versions.ObjectVersioning.ProxyForObjectPrototype) {
            lively.versions.ObjectVersioning.ProxyForObjectPrototype = lively.proxyFor(Object.prototype);
        }
        return lively.versions.ObjectVersioning.ProxyForObjectPrototype;
    },
    getObjectForProxy: function(proxy, optObjectTable) {
        var id = proxy.__objectID;
        
        if (id === undefined) {
            return undefined;
        }
        
        return this.getObjectByID(id, optObjectTable);
    },
    getObjectByID: function(id, optObjectTable) {
        var objectTable = optObjectTable || lively.CurrentObjectTable;
        
        return objectTable[id];
    },
    setObjectForProxy: function(target, proxy, optObjectTable) {
        var objectTable = optObjectTable || lively.CurrentObjectTable;
        objectTable[proxy.__objectID] = target;
    },
    isProxy: function(obj) {
        if (!obj) {
            // primitive falsy values can't be proxied
            return false;
        }
        
        // coerce to boolean
        return !!obj.__isProxy;
    },
    isPrimitiveObject: function(obj) {
        return obj !== Object(obj);
    },
    commitVersion: function() {
        var previousVersion,
            nextVersion;
        
        previousVersion = lively.CurrentObjectTable;
        nextVersion = Object.clone(lively.CurrentObjectTable);
        lively.Versions.push(nextVersion);
        
        // freeze all objects as previous versions shouldn't change,
        // so objects need to be copied on write in following versions
        // however: using Object.freeze() for this has the drawback that
        // objects frozen elsewhere can be written again in following versions
        nextVersion.forEach(function (ea) {
            Object.freeze(ea);
        })
                
        lively.CurrentObjectTable = nextVersion;
        
        return previousVersion; 
    },
    undo: function() {
        var previousVersion = this.previousVersion();
        if (!previousVersion) {
            throw new Error('Can\'t undo: No previous version.');
        }
        lively.CurrentObjectTable = previousVersion;
    },
    redo: function() {
        var followingVersion = this.followingVersion();
        if (!followingVersion) {
            throw new Error('Can\'t redo: No next version.');
        }
        lively.CurrentObjectTable = this.followingVersion();
    },
    previousVersion: function() {
        var index = lively.Versions.indexOf(lively.CurrentObjectTable) - 1;
        if (index < 0) {
            return undefined;
        }
        return lively.Versions[index];
    },
    followingVersion: function() {
        var index = lively.Versions.indexOf(lively.CurrentObjectTable) + 1;
        if (index >= lively.Versions.size()) {
            return undefined;
        }
        return lively.Versions[index];
    },
    start: function() {
        this.init();
        this.wrapEval();
        this.wrapGlobalObjects();
    },
    wrapEval: function() {
        var originalEval = eval;
        eval = function(code) {
            var transformedCode = lively.versions.ObjectVersioning.transformSource(code);
            return originalEval(transformedCode);
        }
    },
    wrapGlobalObjects: function() {
        // TODO: built-in functions that create new objects
        // have to return proxies for the new objects, e.g.

        // Object.create()
        // JSON.parse()
        // Array methods: concat(), slice(), map(), filter()...
        // Date constructor and parse() and UTC()
        // and other global objects in Global / window

        // just proxying every global object doesn't work (reloads, bookmarks..)
        
        // Properties.all(Global).forEach((function(ea) {
        //     if (this.isProxy(Global[ea]) ||
        //         this.isPrimitiveObject(Global[ea])) 
        //             return;
        //
        //     Global[ea] = this.proxy(Global[ea]);
        // }).bind(this));

        Object.create = this.proxyFor(Object.create);
        JSON.parse = this.proxyFor(JSON.parse);
    },
});

Object.extend(lively.versions.ObjectVersioning, {
    transformSource: function(source) {
        return lively.versions.UglifyTransformer.transformSource(source, {beautify: true});
    }
});

// lively OV shortcuts
lively.proxyFor = lively.versions.ObjectVersioning.proxyFor.bind(lively.versions.ObjectVersioning);
lively.objectFor = lively.versions.ObjectVersioning.getObjectForProxy.bind(lively.versions.ObjectVersioning);
lively.isProxy = lively.versions.ObjectVersioning.isProxy.bind(lively.versions.ObjectVersioning);

// start
lively.versions.ObjectVersioning.init();

});