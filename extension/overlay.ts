import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import type {Rect} from './geometry.js';

export class AreaOutline {
    private readonly actor: St.Widget;

    constructor() {
        this.actor = new St.Widget({
            name: 'otd-penframe-outline',
            style_class: 'otd-penframe-outline',
            reactive: false,
            can_focus: false,
            track_hover: false,
            visible: false,
        });
        Main.layoutManager.addTopChrome(this.actor, {affectsStruts: false});
    }

    showArea(area: Rect | null): void {
        if (!area) {
            this.actor.hide();
            return;
        }
        this.actor.set_position(area.x, area.y);
        this.actor.set_size(area.width, area.height);
        this.actor.show();
    }

    destroy(): void {
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
    }
}
