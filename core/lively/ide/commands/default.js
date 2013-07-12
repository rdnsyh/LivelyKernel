module('lively.ide.commands.default').requires().toRun(function() {

Object.extend(lively.ide.commands, {
    byName: {},
    defaultBindings: {},
    exec: function(commandName) {
        var cmd = lively.ide.commands.byName[commandName];
        try {
            return !cmd || !cmd.exec ? null : cmd.exec();
        } catch(err) {
            show('Error when executing command %s:\n %s', commandName, err);
            return false;
        }
    },
    addCommand: function(name, command) {
        if (!command) delete lively.ide.commands.byName[name];
        else lively.ide.commands.byName[name] = command;
    }
});

Object.extend(lively.ide.commands.byName, {
    // world
    'lively.morphic.World.escape': {
        description: 'escape',
        exec: function() {
            // Global Escape will drop grabbed morphs, remove menus, close halos
            var world = lively.morphic.World.current(), h = world.firstHand();
            if (h.submorphs.length > 0) { h.dropContentsOn(world); return true; }
            if (world.worldMenuOpened) { h.removeOpenMenu(event); return true; }
            if (world.currentHaloTarget) { world.removeHalosOfCurrentHaloTarget(); return true; }
            return false;
        }
    },
    'lively.morphic.World.save': {
        description: 'save world',
        exec: function() {
            $world.saveWorld(); return true;
        }
    },
    // morphic
    'lively.morphic.Halos.show': {
        description: 'show halo',
        exec: function() {
            var focused = lively.morphic.Morph.focusedMorph(),
                morph = $world.getActiveWindow() || focused;
            if (!morph) return true;
            if (morph.showsHalos) morph.removeHalos();
            else morph.showHalos();
            focused && focused.focus.bind(focused).delay(0);
            return true;
        }
    },
    // windows
    'lively.morphic.Window.rename': {
        description: 'rename active window',
        exec: function() {
            var focused = lively.morphic.Morph.focusedMorph(),
                win = focused && focused.getWindow();
            if (!win) { show('Cannot find active window!'); return; }
            $world.prompt('Enter new window title', function(input) {
                if (input !== null) win.titleBar.setTitle(input || '');
            }, win.titleBar.getTitle());
            return true;
        }
    },
    'lively.morphic.Window.gather': {
        description: 'gather all windows at mouse cursor',
        exec: function() {
            function restack(parent, filter) {
                var morphs = parent.submorphs.select(filter),
                    pos = parent.hands[0].getPosition();
                morphs.inject(pos, function(pos, win) {
                    win.setPosition(pos);
                    return pos.addXY(30,30);
                });
            }
            restack($world, function(ea) { return ea.isWindow; });
            return true;
        }
    },
    'lively.morphic.Window.close': {
        description: 'close active window',
        exec: function() {
            $world.closeActiveWindow();
            return true;
        }
    },
    'lively.ide.WindowNavigation.start': {
        description: 'open window navigator',
        exec: function() {
            lively.ide.WindowNavigation.WindowManager.current().startWindowSelection();
            return true;
        }
    },
    // commands
    'lively.ide.commands.keys.reset': {
        description: 'reset key bindings',
        exec: function() {
            lively.ide.WindowNavigation.WindowManager.reset();
            lively.morphic.KeyboardDispatcher.reset();
            delete $world['_lively.ide.CommandLineInterface.doGrepSearch.NarrowingList'];
            delete $world['_lively.ide.commands.execute.NarrowingList'];
            return true;
        },
    },
    'lively.ide.tools.SelectionNarrowing.activateLastActive': {
        description: 'open last active selection narrower',
        exec: function() {
            var n = lively.ide.tools.SelectionNarrowing && lively.ide.tools.SelectionNarrowing.lastActive;
            n && n.activate();
        }
    },
    'lively.ide.commands.execute': {
        description: 'execute command',
        exec: function() {
            var w = lively.morphic.World.current();
            var cachedName = '_lively.ide.commands.execute.NarrowingList';
            if (w[cachedName]) { w[cachedName].activate(); return true; }
            if (w.hasOwnProperty('doNotSerialize')) w.doNotSerialize.push(cachedName); else w.doNotSerialize = [cachedName];
            var narrower = w[cachedName] = lively.BuildSpec('lively.ide.tools.NarrowingList').createMorph();
            lively.bindings.connect(narrower, 'confirmedSelection', narrower, 'deactivate');
            lively.bindings.connect(narrower, 'escapePressed', narrower, 'deactivate');
            lively.bindings.connect(narrower, 'activate', narrower, 'selectInput');
            var spec = {
                prompt: 'exec command: ',
                candidates: Properties.forEachOwn(lively.ide.commands.byName, function(name, cmd) {
                    var label = cmd.description || name;
                    return {isListItem: true, string: label, value: cmd}
                }),
                actions: [function(candidate) { candidate.exec(); }]
            }
            narrower.open(spec);
            return true;
        },
    },
    // search
    'lively.ide.CommandLineInterface.doGrepSearch': {
        description: 'code search (grep)',
        exec: function() {
            var w = lively.morphic.World.current();
            var cachedName = '_lively.ide.CommandLineInterface.doGrepSearch.NarrowingList';
            if (w[cachedName]) { w[cachedName].activate(); return true; }
            if (w.hasOwnProperty('doNotSerialize')) w.doNotSerialize.push(cachedName); else w.doNotSerialize = [cachedName];
            var narrower = w[cachedName] = lively.BuildSpec('lively.ide.tools.NarrowingList').createMorph();
            lively.bindings.connect(narrower, 'confirmedSelection', narrower, 'deactivate');
            lively.bindings.connect(narrower, 'escapePressed', narrower, 'deactivate');
            lively.bindings.connect(narrower, 'activate', narrower, 'selectInput');
            var greper = Functions.debounce(500, function(input, callback) {
                lively.ide.CommandLineSearch.doGrep(input, null, function(lines) {
                    callback(lines.asListItemArray());
                })
            });
            var spec = {
                prompt: 'search for: ',
                candidatesUpdaterMinLength: 3,
                candidates: Array.range(0,20).invoke('toString'),
                candidatesUpdater: greper,
                keepInputOnReactivate: true,
                actions: [function(candidate) { lively.ide.CommandLineSearch.doBrowseGrepString(candidate); }]
            }
            narrower.open(spec);
            return true;
        }
    },
    // tools
    'lively.ide.openWorkspace': {description: 'open Workspace', exec: function() { $world.openWorkspace(); }},
    'lively.ide.openSystemCodeBrowser': {description: 'open SystemCodeBrowser', exec: function() { $world.openSystemBrowser(); }},
    'lively.ide.openObjectEditor': {description: 'open ObjectEditor', exec: function() { $world.openObjectEditor(); }},
    'lively.ide.openBuildSpecEditor': {description: 'open BuildSpecEditor', exec: function() { $world.openBuildSpecEditor(); }},
    'lively.ide.openTestRunner': {description: 'open TestRunner', exec: function() { $world.openTestRunner(); }},
    'lively.ide.openMethodFinder': {description: 'open MethodFinder', exec: function() { $world.openMethodFinder(); }},
    'lively.ide.openTextEditor': {description: 'open TextEditor', exec: function() { lively.ide.openFile(URL.source.toString()); }},
    'lively.ide.openSystemConsole': {description: 'open SystemConsole', exec: function() { $world.openSystemConsole(); }},
    'lively.ide.openOMetaWorkspace': {description: 'open OMetaWorkspace', exec: function() { $world.openOMetaWorkspace(); }},
    'lively.ide.openSubserverViewer': {description: 'open SubserverViewer', exec: function() { $world.openSubserverViewer(); }},
    'lively.ide.openServerWorkspace': {description: 'open ServerWorkspace', exec: function() { $world.openServerWorkspace(); }},
    'lively.ide.openTerminal': {description: 'open Terminal', exec: function() { $world.openTerminal(); }},
    'lively.ide.openGitControl': {description: 'open GitControl', exec: function() { $world.openGitControl(); }}
});

Object.extend(lively.ide.commands.defaultBindings, { // bind commands to default keys
    'lively.morphic.World.escape': "esc",
    'lively.morphic.World.save': 'cmd-s-l s a v e',
    'lively.morphic.Window.close': "cmd-esc",
    'lively.morphic.Window.gather':'cmd-s-l s t a c k w',
    'lively.morphic.Window.rename': 'cmd-s-l r e n',
    'lively.ide.WindowNavigation.start': {mac: "cmd-`", win: "ctrl-`"},
    'lively.ide.commands.keys.reset': 'F8',
    'lively.ide.tools.SelectionNarrowing.activateLastActive': "cmd-y",
    'lively.morphic.Halos.show': "cmd-h",
    'lively.ide.CommandLineInterface.doGrepSearch': "cmd-s-g",
    'lively.ide.commands.execute': "m-x"
});

}) // end of module