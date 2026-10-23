/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The attribute that gives an element of BaseHalf its hover, in place of the
 * system's tooltip that a `title` draws (architecture invariants, "Product
 * shell"): the name of a button that shows only an icon, why a control is
 * disabled or refuses what was typed, or the whole of a message that is cut.
 * The workbench's hover shows its text.
 */
export const BASEHALF_HOVER_ATTRIBUTE = 'data-basehalf-hover';
